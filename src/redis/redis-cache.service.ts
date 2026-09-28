import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

@Injectable()
export class RedisCacheService {
  private readonly logger = new Logger(RedisCacheService.name);
  private readonly defaultTtl: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.defaultTtl = config.get<number>('REDIS_CACHE_DEFAULT_TTL_SECONDS', 300);
  }

  async get<T>(key: string): Promise<T | null> {
    const client = this.redis.getClient();
    if (!this.redis.isAvailable() || !client) return null;
    try {
      const value = await client.get(key);
      return value ? (JSON.parse(value) as T) : null;
    } catch (error: unknown) {
      this.logger.warn(`Redis cache read failed: ${this.safeMessage(error)}`);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds = this.defaultTtl): Promise<void> {
    const client = this.redis.getClient();
    if (!this.redis.isAvailable() || !client) return;
    try {
      await client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error: unknown) {
      this.logger.warn(`Redis cache write failed: ${this.safeMessage(error)}`);
    }
  }

  async delete(...keys: string[]): Promise<void> {
    const client = this.redis.getClient();
    if (!this.redis.isAvailable() || !client || keys.length === 0) return;
    try {
      await client.del(...keys);
    } catch (error: unknown) {
      this.logger.warn(`Redis cache invalidation failed: ${this.safeMessage(error)}`);
    }
  }

  private safeMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
  }
}
