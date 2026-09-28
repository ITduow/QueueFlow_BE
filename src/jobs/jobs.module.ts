import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationProcessor } from './notification/notification.processor';
import { NotificationQueue } from './notification/notification.queue';

@Module({
  imports: [ConfigModule, PrismaModule, RedisModule, RealtimeModule],
  providers: [NotificationQueue, NotificationProcessor],
  exports: [NotificationQueue],
})
export class JobsModule {}
