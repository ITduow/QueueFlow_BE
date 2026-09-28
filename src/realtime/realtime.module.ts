import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BusinessesModule } from '../businesses/businesses.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { QueueGateway } from './queue.gateway';
import { RealtimeService } from './realtime.service';
import { WebsocketAuthService } from './websocket-auth.service';
import { SocketIoRedisAdapterService } from './socket-io-redis-adapter.service';

@Module({
  imports: [AuthModule, BusinessesModule, PrismaModule, RedisModule],
  providers: [RealtimeService, WebsocketAuthService, QueueGateway, SocketIoRedisAdapterService],
  exports: [RealtimeService, SocketIoRedisAdapterService],
})
export class RealtimeModule {}
