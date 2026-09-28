import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../src/auth/guards/roles.guard';

describe('RolesGuard', () => {
  function contextFor(role: UserRole | undefined): ExecutionContext {
    return {
      getHandler: () => function handler() {},
      getClass: () => class TestController {},
      switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }),
    } as unknown as ExecutionContext;
  }

  it('allows an authenticated user when no roles are required', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    expect(new RolesGuard(reflector).canActivate(contextFor(UserRole.CUSTOMER))).toBe(true);
  });

  it('allows a matching role and rejects a different role', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([UserRole.ADMIN]),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(contextFor(UserRole.ADMIN))).toBe(true);
    expect(() => guard.canActivate(contextFor(UserRole.CUSTOMER))).toThrow(ForbiddenException);
  });
});
