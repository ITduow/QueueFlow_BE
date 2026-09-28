import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { OpeningHoursService } from '../src/services/opening-hours.service';
import { BusinessesService } from '../src/businesses/businesses.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthenticatedUser } from '../src/auth/interfaces/authenticated-user.interface';

const manager: AuthenticatedUser = {
  id: 'manager-id',
  email: 'manager@example.com',
  fullName: 'Manager',
  phone: null,
  avatarUrl: null,
  role: UserRole.MANAGER,
  isActive: true,
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('OpeningHoursService', () => {
  it('replaces a weekly schedule atomically and maps HH:mm to TIME dates', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 2 });
    const transaction = jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        businessOpeningHour: {
          deleteMany: jest.fn(),
          createMany,
          findMany: jest.fn().mockResolvedValue([
            {
              dayOfWeek: 1,
              openTime: new Date(Date.UTC(1970, 0, 1, 9)),
              closeTime: new Date(Date.UTC(1970, 0, 1, 18)),
              isClosed: false,
            },
            { dayOfWeek: 0, openTime: null, closeTime: null, isClosed: true },
          ]),
        },
      }),
    );
    const businesses = {
      assertManagerAccess: jest.fn().mockResolvedValue(undefined),
    } as unknown as BusinessesService;
    const service = new OpeningHoursService(
      { $transaction: transaction } as unknown as PrismaService,
      businesses,
    );

    const result = await service.replace('business-id', manager, {
      hours: [
        { dayOfWeek: 1, openTime: '09:00', closeTime: '18:00', isClosed: false },
        { dayOfWeek: 0, isClosed: true },
      ],
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            dayOfWeek: 1,
            openTime: expect.any(Date),
            closeTime: expect.any(Date),
          }),
        ]),
      }),
    );
    expect(result[0].openTime).toBe('09:00');
  });

  it('rejects duplicate days before starting a transaction', async () => {
    const transaction = jest.fn();
    const businesses = {
      assertManagerAccess: jest.fn().mockResolvedValue(undefined),
    } as unknown as BusinessesService;
    const service = new OpeningHoursService(
      { $transaction: transaction } as unknown as PrismaService,
      businesses,
    );

    await expect(
      service.replace('business-id', manager, {
        hours: [
          { dayOfWeek: 1, openTime: '09:00', closeTime: '18:00', isClosed: false },
          { dayOfWeek: 1, isClosed: true },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });
});
