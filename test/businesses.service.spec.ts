import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { BusinessStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { BusinessesService } from '../src/businesses/businesses.service';
import { AuthenticatedUser } from '../src/auth/interfaces/authenticated-user.interface';
import { BusinessSortField } from '../src/businesses/dto/list-businesses-query.dto';

const actor = (id: string, role: UserRole): AuthenticatedUser => ({
  id,
  email: `${id}@example.com`,
  fullName: 'Test Actor',
  phone: null,
  avatarUrl: null,
  role,
  isActive: true,
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('BusinessesService', () => {
  it('creates a pending business owned by the authenticated user', async () => {
    const create = jest
      .fn()
      .mockResolvedValue({ id: 'business-id', slug: 'my-clinic', status: BusinessStatus.PENDING });
    const prisma = { business: { create } } as unknown as PrismaService;
    const service = new BusinessesService(prisma);

    await service.create('owner-id', { name: 'My Clinic' });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: 'owner-id',
          slug: 'my-clinic',
          status: BusinessStatus.PENDING,
        }),
      }),
    );
  });

  it('rejects non-owner member access to another business', async () => {
    const prisma = {
      business: {
        findUnique: jest.fn().mockResolvedValue({ id: 'business-id', ownerId: 'other-owner' }),
      },
      businessMember: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new BusinessesService(prisma);

    await expect(
      service.listMembers('business-id', actor('staff-id', UserRole.STAFF)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a manager to update a business but not its status', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'business-id' });
    const prisma = {
      business: {
        findUnique: jest.fn().mockResolvedValue({ id: 'business-id', ownerId: 'owner-id' }),
        update,
      },
    } as unknown as PrismaService;
    const service = new BusinessesService(prisma);
    jest.spyOn(service, 'getAccess').mockResolvedValue({
      businessId: 'business-id',
      isAdmin: false,
      isOwner: false,
      membershipRole: UserRole.MANAGER,
    });

    await service.update('business-id', actor('manager-id', UserRole.MANAGER), {
      name: 'Updated Clinic',
    });
    expect(update).toHaveBeenCalled();
    await expect(
      service.update('business-id', actor('manager-id', UserRole.MANAGER), {
        status: BusinessStatus.ACTIVE,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('protects public visibility from non-active status filters', async () => {
    const service = new BusinessesService({} as PrismaService);
    await expect(
      service.listPublic({
        page: 1,
        limit: 20,
        status: BusinessStatus.SUSPENDED,
        sortBy: BusinessSortField.CREATED_AT,
        sortOrder: 'desc',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps duplicate slug errors to a conflict', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: '7.10.0',
    });
    const prisma = {
      business: { create: jest.fn().mockRejectedValue(duplicate) },
    } as unknown as PrismaService;
    const service = new BusinessesService(prisma);
    await expect(service.create('owner-id', { name: 'My Clinic' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
