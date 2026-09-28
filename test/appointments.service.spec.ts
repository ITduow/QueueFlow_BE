import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AppointmentStatus, UserRole } from '@prisma/client';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { AppointmentTransitionService } from '../src/appointments/appointment-transition.service';
import { AuthenticatedUser } from '../src/auth/interfaces/authenticated-user.interface';
import { PrismaService } from '../src/prisma/prisma.service';
import { AvailabilityService } from '../src/services/availability.service';
import { BusinessesService } from '../src/businesses/businesses.service';

const actor: AuthenticatedUser = {
  id: 'customer-id',
  email: 'customer@example.com',
  fullName: 'Customer',
  phone: null,
  avatarUrl: null,
  role: UserRole.CUSTOMER,
  isActive: true,
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AppointmentsService', () => {
  it('calculates end time server-side and rejects an existing service overlap', async () => {
    const startTime = new Date(Date.now() + 60 * 60_000);
    const prisma = {
      business: {
        findUnique: jest.fn().mockResolvedValue({ id: 'business-id', status: 'ACTIVE' }),
      },
      service: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'service-id',
          businessId: 'business-id',
          isActive: true,
          durationMinutes: 30,
        }),
      },
      appointment: { findFirst: jest.fn().mockResolvedValue({ id: 'existing-id' }) },
    } as unknown as PrismaService;
    const availability = {
      calculateServiceEndTime: jest.fn(
        (start: Date, duration: number) => new Date(start.getTime() + duration * 60_000),
      ),
      isBusinessOpenForInterval: jest.fn().mockResolvedValue(true),
    } as unknown as AvailabilityService;
    const service = new AppointmentsService(
      prisma,
      {} as BusinessesService,
      availability,
      {} as AppointmentTransitionService,
    );

    await expect(
      service.create(actor, {
        businessId: 'business-id',
        serviceId: 'service-id',
        startTime: startTime.toISOString(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(availability.calculateServiceEndTime).toHaveBeenCalledWith(startTime, 30);
  });

  it('rejects an unrelated user from appointment detail', async () => {
    const prisma = {
      appointment: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'appointment-id',
          customerId: 'another-customer',
          businessId: 'business-id',
        }),
      },
    } as unknown as PrismaService;
    const businesses = {
      getAccess: jest.fn().mockResolvedValue({
        isAdmin: false,
        isOwner: false,
        membershipRole: null,
      }),
    } as unknown as BusinessesService;
    const service = new AppointmentsService(
      prisma,
      businesses,
      {} as AvailabilityService,
      {} as AppointmentTransitionService,
    );

    await expect(service.getById('appointment-id', actor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('returns a conflict when availability pre-check finds customer overlap', async () => {
    const prisma = {
      business: {
        findUnique: jest.fn().mockResolvedValue({ id: 'business-id', status: 'ACTIVE' }),
      },
      service: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'service-id',
          businessId: 'business-id',
          isActive: true,
          durationMinutes: 30,
        }),
      },
      appointment: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'customer-overlap' }),
      },
    } as unknown as PrismaService;
    const availability = {
      calculateServiceEndTime: jest.fn(
        (start: Date, duration: number) => new Date(start.getTime() + duration * 60_000),
      ),
      isBusinessOpenForInterval: jest.fn().mockResolvedValue(true),
    } as unknown as AvailabilityService;
    const service = new AppointmentsService(
      prisma,
      {} as BusinessesService,
      availability,
      {} as AppointmentTransitionService,
    );
    const startTime = new Date(Date.now() + 60 * 60_000);

    await expect(
      service.create(actor, {
        businessId: 'business-id',
        serviceId: 'service-id',
        startTime: startTime.toISOString(),
      }),
    ).rejects.toMatchObject({ response: { code: 'APPOINTMENT_CUSTOMER_TIME_CONFLICT' } });
  });
});

describe('AppointmentTransitionService', () => {
  it('uses a conditional update and maps a lost race to invalid state', async () => {
    const prisma = {
      appointment: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({ id: 'appointment-id' }),
      },
    } as unknown as PrismaService;
    const service = new AppointmentTransitionService(prisma);

    await expect(
      service.transition(
        'appointment-id',
        AppointmentStatus.CONFIRMED,
        AppointmentStatus.COMPLETED,
      ),
    ).rejects.toMatchObject({ response: { code: 'APPOINTMENT_INVALID_STATE' } });
    expect(prisma.appointment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'appointment-id', status: AppointmentStatus.CONFIRMED },
      }),
    );
  });
});
