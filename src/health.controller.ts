import { Controller, Get, Optional, ServiceUnavailableException } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';
import { SocketIoRedisAdapterService } from './realtime/socket-io-redis-adapter.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly realtimeAdapter?: SocketIoRedisAdapterService,
  ) {}

  @Public()
  @Get()
  async check(): Promise<{ status: string; database: string; redis: string; timestamp: string }> {
    const result = await this.readyCheck();
    return { ...result, status: 'ok' };
  }

  @Public()
  @Get('live')
  live(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Public()
  @Get('ready')
  async ready(): Promise<{ status: string; database: string; redis: string; timestamp: string }> {
    return this.readyCheck();
  }

  private async readyCheck(): Promise<{
    status: string;
    database: string;
    redis: string;
    timestamp: string;
  }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const redis =
        this.redis?.isAvailable() && (this.realtimeAdapter?.isReady() ?? true)
          ? 'connected'
          : 'unavailable';
      return {
        status: redis === 'connected' ? 'ok' : 'degraded',
        database: 'connected',
        redis,
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException({
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database is unavailable',
      });
    }
  }
}
