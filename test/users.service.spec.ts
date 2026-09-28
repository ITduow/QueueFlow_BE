import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PasswordService } from '../src/auth/password.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { UsersService } from '../src/users/users.service';
import { UserSortField } from '../src/users/dto/list-users-query.dto';

describe('UsersService', () => {
  const passwordService = new PasswordService();

  it('updates only allowlisted profile fields', async () => {
    const update = jest.fn().mockResolvedValue({
      id: 'user-id',
      email: 'user@example.com',
      fullName: 'Updated User',
      phone: null,
      avatarUrl: null,
      role: UserRole.CUSTOMER,
      isActive: true,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const prisma = { user: { update } } as unknown as PrismaService;
    const service = new UsersService(prisma);

    await service.updateProfile('user-id', { fullName: ' Updated User ' });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-id' },
        data: { fullName: 'Updated User' },
      }),
    );
    expect(update.mock.calls[0][0].data.role).toBeUndefined();
  });

  it('changes password and revokes sessions in one transaction', async () => {
    const oldHash = await passwordService.hash('OldPassword123');
    const update = jest.fn().mockResolvedValue(undefined);
    const revoke = jest.fn().mockResolvedValue({ count: 2 });
    const transaction = jest.fn(async (callback: (tx: unknown) => Promise<void>) =>
      callback({
        user: { update },
        refreshToken: { updateMany: revoke },
      }),
    );
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-id', passwordHash: oldHash }) },
      $transaction: transaction,
    } as unknown as PrismaService;
    const service = new UsersService(prisma);

    await service.changePassword(
      'user-id',
      { currentPassword: 'OldPassword123', newPassword: 'NewPassword456' },
      passwordService,
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user-id' } }));
    expect(revoke).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-id', revokedAt: null } }),
    );
  });

  it('rejects an invalid current password and does not open a transaction', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-id',
          passwordHash: await passwordService.hash('OldPassword123'),
        }),
      },
      $transaction: jest.fn(),
    } as unknown as PrismaService;
    const service = new UsersService(prisma);

    await expect(
      service.changePassword(
        'user-id',
        { currentPassword: 'WrongPassword123', newPassword: 'NewPassword456' },
        passwordService,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('paginates and filters admin user queries', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = {
      user: { findMany, count },
      $transaction: jest.fn().mockResolvedValue([[], 0]),
    } as unknown as PrismaService;
    const service = new UsersService(prisma);

    const result = await service.listUsersForAdmin({
      page: 2,
      limit: 10,
      search: 'andy',
      role: UserRole.CUSTOMER,
      isActive: true,
      sortBy: UserSortField.CREATED_AT,
      sortOrder: 'desc',
    });

    expect(result.meta).toEqual({ page: 2, limit: 10, total: 0, totalPages: 0 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('protects self-disable and last-admin cases', async () => {
    const service = new UsersService({} as PrismaService);
    await expect(service.setUserActiveStatus('admin-id', false, 'admin-id')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    const tx = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'other-admin', role: UserRole.ADMIN, isActive: true }),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (value: unknown) => Promise<unknown>) => callback(tx)),
    } as unknown as PrismaService;
    const guardedService = new UsersService(prisma);
    await expect(
      guardedService.setUserActiveStatus('other-admin', false, 'admin-id'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
