import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

jest.mock('@nestjs/jwt', () => ({ JwtService: class JwtService {} }));

import { AuthService } from '../src/auth/auth.service';
import { PasswordService } from '../src/auth/password.service';
import { UsersService } from '../src/users/users.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('AuthService', () => {
  const passwordService = new PasswordService();
  const config = {
    getOrThrow: (key: string) =>
      ({
        JWT_ACCESS_SECRET: 'a'.repeat(40),
        JWT_REFRESH_SECRET: 'b'.repeat(40),
        JWT_ACCESS_EXPIRES_IN: '15m',
        JWT_REFRESH_EXPIRES_IN: '7d',
      })[key],
  };

  it('normalizes email, hashes password, and creates a customer', async () => {
    const createCustomer = jest
      .fn()
      .mockImplementation(async (data: { email: string; passwordHash: string }) => ({
        id: 'user-id',
        email: data.email,
        fullName: 'Test User',
        phone: null,
        avatarUrl: null,
        role: 'CUSTOMER',
        isActive: true,
        emailVerified: false,
      }));
    const users = { createCustomer } as unknown as UsersService;
    const service = new AuthService(
      users,
      {} as PrismaService,
      passwordService,
      {} as never,
      config as never,
    );

    await service.register({
      email: ' TEST@Example.COM ',
      password: 'Password123',
      fullName: 'Test User',
    });

    expect(createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'test@example.com' }),
    );
    const passwordHash = createCustomer.mock.calls[0][0].passwordHash as string;
    expect(passwordHash).not.toBe('Password123');
    await expect(passwordService.verify(passwordHash, 'Password123')).resolves.toBe(true);
  });

  it('maps duplicate email database errors to a conflict', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: '7.10.0',
    });
    const users = {
      createCustomer: jest.fn().mockRejectedValue(duplicate),
    } as unknown as UsersService;
    const service = new AuthService(
      users,
      {} as PrismaService,
      passwordService,
      {} as never,
      config as never,
    );

    await expect(
      service.register({
        email: 'test@example.com',
        password: 'Password123',
        fullName: 'Test User',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns a generic error for an unknown login email', async () => {
    const users = { findByEmail: jest.fn().mockResolvedValue(null) } as unknown as UsersService;
    const service = new AuthService(
      users,
      {} as PrismaService,
      passwordService,
      {} as never,
      config as never,
    );

    await expect(
      service.login(
        { email: 'missing@example.com', password: 'Password123' },
        { userAgent: null, ipAddress: null },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rotates a valid refresh token and revokes the old record', async () => {
    const oldToken = 'old-refresh-token';
    const oldHash = await passwordService.hash(oldToken);
    const user = {
      id: 'user-id',
      email: 'user@example.com',
      fullName: 'Test User',
      phone: null,
      avatarUrl: null,
      role: 'CUSTOMER',
      isActive: true,
      emailVerified: false,
      passwordHash: oldHash,
    } as const;
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const create = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      refreshToken: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'refresh-id',
          userId: 'user-id',
          tokenHash: oldHash,
          expiresAt: new Date(Date.now() + 60_000),
          revokedAt: null,
        }),
      },
      $transaction: jest.fn(async (callback: (transaction: unknown) => Promise<boolean>) =>
        callback({ refreshToken: { updateMany, create } }),
      ),
    } as unknown as PrismaService;
    const users = { findAuthById: jest.fn().mockResolvedValue(user) } as unknown as UsersService;
    const jwt = {
      verifyAsync: jest.fn().mockResolvedValue({ sub: 'user-id', jti: 'refresh-id' }),
      signAsync: jest
        .fn()
        .mockResolvedValueOnce('new-refresh-token')
        .mockResolvedValueOnce('new-access-token'),
    };
    const service = new AuthService(users, prisma, passwordService, jwt as never, config as never);

    const result = await service.refresh(oldToken, { userAgent: 'jest', ipAddress: '127.0.0.1' });

    expect(result).toEqual({ accessToken: 'new-access-token', refreshToken: 'new-refresh-token' });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'refresh-id', revokedAt: null } }),
    );
    expect(create).toHaveBeenCalledTimes(1);
  });
});
