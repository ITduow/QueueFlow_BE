import { NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { Job } from 'bullmq';
import { NotificationJobFactory } from '../src/notifications/notification-job.factory';
import { NotificationsService } from '../src/notifications/notifications.service';
import { NotificationProcessor } from '../src/jobs/notification/notification.processor';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { NotificationJobPayload } from '../src/notifications/types/notification-job-payload.type';

describe('NotificationJobFactory', () => {
  it('creates a minimal queue-called payload with one stable event id', () => {
    const payload = NotificationJobFactory.queueCalled('user-id', 'queue-id', 'entry-id', 'A015');

    expect(payload).toMatchObject({
      userId: 'user-id',
      type: NotificationType.QUEUE_CALLED,
      data: { queueId: 'queue-id', queueEntryId: 'entry-id', queueNumber: 'A015' },
    });
    expect(payload.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(payload)).not.toContain('password');
  });
});

describe('NotificationsService', () => {
  it('scopes list and unread count to the authenticated user', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(2);
    const prisma = {
      notification: { findMany, count },
      $transaction: jest.fn().mockResolvedValue([[], 2]),
    } as unknown as PrismaService;
    const service = new NotificationsService(prisma);

    await service.list('user-a', { page: 1, limit: 20 });
    await service.unreadCount('user-a');

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(count).toHaveBeenCalledWith({ where: { userId: 'user-a', isRead: false } });
  });

  it('conceals another user notification on mark read', async () => {
    const prisma = {
      notification: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new NotificationsService(prisma);

    await expect(service.markRead('user-a', 'notification-b')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('marks all unread notifications with one updateMany call', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 3 });
    const prisma = { notification: { updateMany } } as unknown as PrismaService;
    const service = new NotificationsService(prisma);

    await expect(service.markAllRead('user-a')).resolves.toEqual({ updatedCount: 3 });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-a', isRead: false } }),
    );
  });
});

describe('NotificationProcessor', () => {
  const payload: NotificationJobPayload = {
    eventId: 'event-id',
    userId: 'user-id',
    type: NotificationType.QUEUE_CALLED,
    title: 'Called',
    message: 'A001 called',
    data: { queueId: 'queue-id' },
  };

  it('persists before emitting notification:new', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'notification-id',
      type: payload.type,
      title: payload.title,
      message: payload.message,
      data: payload.data,
      isRead: false,
      createdAt: new Date(),
      readAt: null,
    });
    const prisma = { notification: { create } } as unknown as PrismaService;
    const realtime = { emitToUser: jest.fn() } as unknown as RealtimeService;
    const service = new NotificationProcessor(
      prisma,
      realtime,
      { isAvailable: jest.fn().mockReturnValue(true) } as unknown as RedisService,
      {} as never,
    );

    await (
      service as unknown as { process(job: Job<NotificationJobPayload>): Promise<void> }
    ).process({ data: payload } as Job<NotificationJobPayload>);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sourceEventId: 'event-id' }) }),
    );
    expect(realtime.emitToUser).toHaveBeenCalled();
  });

  it('treats duplicate sourceEventId as successful idempotent processing', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: '7.10.0',
    });
    const create = jest.fn().mockRejectedValue(duplicate);
    const prisma = { notification: { create } } as unknown as PrismaService;
    const realtime = { emitToUser: jest.fn() } as unknown as RealtimeService;
    const service = new NotificationProcessor(
      prisma,
      realtime,
      { isAvailable: jest.fn().mockReturnValue(true) } as unknown as RedisService,
      {} as never,
    );

    await expect(
      (service as unknown as { process(job: Job<NotificationJobPayload>): Promise<void> }).process({
        data: payload,
      } as Job<NotificationJobPayload>),
    ).resolves.toBeUndefined();
    expect(realtime.emitToUser).not.toHaveBeenCalled();
  });
});
