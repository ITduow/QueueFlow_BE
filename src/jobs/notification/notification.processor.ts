import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, NotificationType } from '@prisma/client';
import { Job, Worker } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { RealtimeEvents } from '../../realtime/realtime-events';
import { RealtimeService } from '../../realtime/realtime.service';
import { createBullMqConnection } from '../bullmq-connection.factory';
import { NOTIFICATION_QUEUE_NAME } from '../queue.constants';
import { NotificationJobPayload } from '../../notifications/types/notification-job-payload.type';

@Injectable()
export class NotificationProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationProcessor.name);
  private worker: Worker<NotificationJobPayload> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const connection = createBullMqConnection(this.config);
    if (!connection) {
      this.logger.warn('Notification worker disabled; REDIS_URL is not configured');
      return;
    }
    this.worker = new Worker<NotificationJobPayload>(
      NOTIFICATION_QUEUE_NAME,
      (job) => this.process(job),
      {
        connection,
        prefix: this.config.get<string>('BULLMQ_PREFIX', 'queueflow'),
        concurrency: 5,
      },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(
        `Notification job failed jobId=${job?.id ?? 'unknown'} eventId=${job?.data.eventId ?? 'unknown'} attempts=${job?.attemptsMade ?? 0}: ${error.message}`,
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  private async process(job: Job<NotificationJobPayload>): Promise<void> {
    const payload = this.validatePayload(job.data);
    let notification;
    try {
      notification = await this.prisma.notification.create({
        data: {
          sourceEventId: payload.eventId,
          userId: payload.userId,
          type: payload.type,
          title: payload.title,
          message: payload.message,
          data: payload.data,
        },
        select: {
          id: true,
          type: true,
          title: true,
          message: true,
          data: true,
          isRead: true,
          createdAt: true,
          readAt: true,
        },
      });
    } catch (error: unknown) {
      if (this.isUniqueViolation(error)) return;
      throw error;
    }
    if (!this.redis.isAvailable()) return;
    this.realtime.emitToUser(payload.userId, RealtimeEvents.notificationNew, {
      ...notification,
      timestamp: new Date().toISOString(),
    });
  }

  private validatePayload(payload: NotificationJobPayload): NotificationJobPayload {
    if (
      !payload ||
      typeof payload.eventId !== 'string' ||
      typeof payload.userId !== 'string' ||
      !Object.values(NotificationType).includes(payload.type) ||
      typeof payload.title !== 'string' ||
      typeof payload.message !== 'string'
    ) {
      throw new Error('Invalid notification job payload');
    }
    return payload;
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
