import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { BusinessStatus, UserRole } from '@prisma/client';
import { BusinessesService } from '../src/businesses/businesses.service';
import { AuthenticatedUser } from '../src/auth/interfaces/authenticated-user.interface';
import { PrismaService } from '../src/prisma/prisma.service';
import { ServicesService } from '../src/services/services.service';

const actor = (id: string, role: UserRole): AuthenticatedUser => ({
  id,
  email: `${id}@example.com`,
  fullName: 'Actor',
  phone: null,
  avatarUrl: null,
  role,
  isActive: true,
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('ServicesService', () => {
  it('allows a manager to create a service with decimal price input', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'service-id' });
    const prisma = { service: { create } } as unknown as PrismaService;
    const businesses = {
      assertManagerAccess: jest.fn().mockResolvedValue(undefined),
    } as unknown as BusinessesService;
    const service = new ServicesService(prisma, businesses);

    await service.create('business-id', actor('manager-id', UserRole.MANAGER), {
      name: ' Haircut ',
      durationMinutes: 30,
      price: '100000.00',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Haircut', price: '100000.00' }),
      }),
    );
  });

  it('relies on business-scoped access and denies staff through the permission service', async () => {
    const businesses = {
      assertManagerAccess: jest.fn().mockRejectedValue(new ForbiddenException()),
    } as unknown as BusinessesService;
    const service = new ServicesService({} as PrismaService, businesses);
    await expect(
      service.create('other-business', actor('staff-id', UserRole.STAFF), {
        name: 'Haircut',
        durationMinutes: 30,
        price: '100000',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('hides inactive services from public business listing', async () => {
    const prisma = {
      business: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'business-id', status: BusinessStatus.SUSPENDED }),
      },
    } as unknown as PrismaService;
    const service = new ServicesService(prisma, {} as BusinessesService);
    await expect(service.listPublic('business-id')).rejects.toBeInstanceOf(NotFoundException);
  });
});
