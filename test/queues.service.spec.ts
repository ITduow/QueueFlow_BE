import { ConflictException } from '@nestjs/common';
import { QueueEntryStatus, UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../src/auth/interfaces/authenticated-user.interface';
import { PrismaService } from '../src/prisma/prisma.service';
import { AvailabilityService } from '../src/services/availability.service';
import { BusinessesService } from '../src/businesses/businesses.service';
import { QueueTransitionService } from '../src/queues/queue-transition.service';
import { QueueWaitTimeService } from '../src/queues/queue-wait-time.service';
import { QueuesService } from '../src/queues/queues.service';
import { formatQueueNumber } from '../src/queues/utils/queue-number.util';

const customer: AuthenticatedUser = {
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

const staff: AuthenticatedUser = { ...customer, id: 'staff-id', role: UserRole.STAFF };

describe('queue number and waiting time helpers', () => {
  it.each([
    [1, 'A001'],
    [9, 'A009'],
    [10, 'A010'],
    [999, 'A999'],
    [1000, 'A1000'],
  ])('formats %s as %s', (number, expected) => {
    expect(formatQueueNumber(number)).toBe(expected);
  });

  it('sums only active entries ahead', async () => {
    const prisma = {
      queueEntry: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { service: { durationMinutes: 30 } },
            { service: { durationMinutes: 15 } },
          ]),
      },
    } as unknown as PrismaService;
    const service = new QueueWaitTimeService(prisma);

    await expect(service.calculateForEntry('queue-id', 3)).resolves.toBe(45);
    expect(prisma.queueEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ queueNumber: { lt: 3 } }) }),
    );
  });
});

describe('QueuesService', () => {
  it('allocates the queue number with an atomic increment in the transaction', async () => {
    const entry = {
      id: 'entry-id',
      queueId: 'queue-id',
      customerId: customer.id,
      serviceId: 'service-id',
      queueNumber: 7,
      status: QueueEntryStatus.WAITING,
      joinedAt: new Date(),
      calledAt: null,
      servingAt: null,
      completedAt: null,
      estimatedWaitMinutes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      customer: { id: customer.id, fullName: customer.fullName },
      service: { id: 'service-id', name: 'Cut', durationMinutes: 30 },
    };
    const tx = {
      queue: { update: jest.fn().mockResolvedValue({ lastQueueNumber: 7 }) },
      queueEntry: { create: jest.fn().mockResolvedValue(entry) },
    };
    const prisma = {
      queue: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'queue-id',
          businessId: 'business-id',
          queueDate: new Date('2026-09-27T00:00:00.000Z'),
          isActive: true,
          business: { status: 'ACTIVE' },
        }),
      },
      service: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'service-id', businessId: 'business-id', isActive: true }),
      },
      queueEntry: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    } as unknown as PrismaService;
    const businesses = {
      getAccess: jest
        .fn()
        .mockResolvedValue({ isAdmin: false, isOwner: true, membershipRole: null }),
    } as unknown as BusinessesService;
    const availability = {
      getBusinessLocalDateTime: jest.fn().mockResolvedValue({ year: 2026, month: 9, day: 27 }),
    } as unknown as AvailabilityService;
    const wait = {
      calculateForEntry: jest.fn().mockResolvedValue(0),
    } as unknown as QueueWaitTimeService;
    const service = new QueuesService(
      prisma,
      businesses,
      availability,
      {} as QueueTransitionService,
      wait,
    );

    const result = await service.join('queue-id', customer, { serviceId: 'service-id' });

    expect(tx.queue.update).toHaveBeenCalledWith({
      where: { id: 'queue-id' },
      data: { lastQueueNumber: { increment: 1 } },
      select: { lastQueueNumber: true },
    });
    expect(tx.queueEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ queueNumber: 7 }) }),
    );
    expect(result.formattedQueueNumber).toBe('A007');
  });

  it('maps a duplicate active join to a conflict', async () => {
    const prisma = {
      queue: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'queue-id',
          businessId: 'business-id',
          queueDate: new Date('2026-09-27T00:00:00.000Z'),
          isActive: true,
          business: { status: 'ACTIVE' },
        }),
      },
      service: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'service-id', businessId: 'business-id', isActive: true }),
      },
      queueEntry: {
        findFirst: jest.fn().mockResolvedValue({ id: 'existing-entry' }),
      },
    } as unknown as PrismaService;
    const availability = {
      getBusinessLocalDateTime: jest.fn().mockResolvedValue({ year: 2026, month: 9, day: 27 }),
    } as unknown as AvailabilityService;
    const service = new QueuesService(
      prisma,
      {} as BusinessesService,
      availability,
      {} as QueueTransitionService,
      {} as QueueWaitTimeService,
    );

    await expect(
      service.join('queue-id', customer, { serviceId: 'service-id' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('uses SKIP LOCKED query and returns queue empty when no row is available', async () => {
    const prisma = {
      queue: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ businessId: 'business-id' })
          .mockResolvedValueOnce({ isActive: true }),
      },
      $queryRaw: jest.fn(),
    } as unknown as PrismaService;
    const businesses = {
      getAccess: jest
        .fn()
        .mockResolvedValue({ isAdmin: false, isOwner: true, membershipRole: null }),
    } as unknown as BusinessesService;
    const tx = { $queryRaw: jest.fn().mockResolvedValue([]) };
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn(
      async (callback: (value: typeof tx) => unknown) => callback(tx),
    );
    const service = new QueuesService(
      prisma,
      businesses,
      {} as AvailabilityService,
      {} as QueueTransitionService,
      {} as QueueWaitTimeService,
    );

    await expect(service.next('queue-id', staff)).rejects.toMatchObject({
      response: { code: 'QUEUE_EMPTY' },
    });
    expect(tx.$queryRaw).toHaveBeenCalled();
  });
});

describe('QueueTransitionService', () => {
  it('maps a lost conditional transition race to QUEUE_INVALID_STATE', async () => {
    const prisma = {
      queueEntry: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({ id: 'entry-id' }),
      },
    } as unknown as PrismaService;
    const service = new QueueTransitionService(prisma);

    await expect(
      service.transition(
        'entry-id',
        QueueEntryStatus.CALLED,
        QueueEntryStatus.SERVING,
        'servingAt',
      ),
    ).rejects.toMatchObject({ response: { code: 'QUEUE_INVALID_STATE' } });
  });
});
