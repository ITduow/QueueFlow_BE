import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { RedisService } from '../../redis/redis.service';
import { createBullMqConnection } from '../bullmq-connection.factory';
import { BULLMQ_JOB_NAME, NOTIFICATION_QUEUE_NAME } from '../queue.constants';
import { NotificationJobPayload } from '../../notifications/types/notification-job-payload.type';

@Injectable()
export class NotificationQueue implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationQueue.name);
  private readonly queue: Queue<NotificationJobPayload> | null;
  private readonly attempts: number;
  private readonly backoffMs: number;

  constructor(
    config: ConfigService,
    private readonly redis: RedisService,
  ) {
    this.attempts = config.get<number>('NOTIFICATION_JOB_ATTEMPTS', 5);
    this.backoffMs = config.get<number>('NOTIFICATION_JOB_BACKOFF_MS', 1000);
    const connection = createBullMqConnection(config);
    this.queue = connection
      ? new Queue<NotificationJobPayload>(NOTIFICATION_QUEUE_NAME, {
          connection,
          prefix: config.get<string>('BULLMQ_PREFIX', 'queueflow'),
        })
      : null;
  }

  async enqueueBestEffort(payload: NotificationJobPayload): Promise<void> {
    if (!this.queue || !this.redis.isAvailable()) {
      this.logger.warn(
        `Notification enqueue skipped; Redis unavailable for event ${payload.eventId}`,
      );
      return;
    }
    try {
      await this.queue.add(BULLMQ_JOB_NAME, payload, {
        // BullMQ custom ids cannot contain `:`. Keep the event id in the job id
        // so retries and duplicate enqueue attempts remain idempotent.
        jobId: `notification-${payload.eventId}`,
        attempts: this.attempts,
        backoff: { type: 'exponential', delay: this.backoffMs },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 86400, count: 5000 },
      });
    } catch (error: unknown) {
      this.logger.warn(
        `Notification enqueue failed for event ${payload.eventId}: ${this.safeMessage(error)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }

  private safeMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
  }
}
