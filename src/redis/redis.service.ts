import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RedisService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis | null;
  private ready = false;
  private closing = false;

  constructor(private readonly config: ConfigService) {
    this.client = null;
    const url = config.get<string>('REDIS_URL');
    if (!url) return;
    const options: RedisOptions = {
      lazyConnect: true,
      connectTimeout: config.get<number>('REDIS_CONNECT_TIMEOUT_MS', 5000),
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => (this.closing ? null : Math.min(times * 250, 5000)),
    };
    this.client = new Redis(url, options);
    this.client.on('ready', () => {
      this.ready = true;
      this.logger.log('Redis connection ready');
    });
    this.client.on('close', () => {
      this.ready = false;
      if (!this.closing) this.logger.warn('Redis connection closed; cache degraded');
    });
    this.client.on('error', (error) => {
      this.ready = false;
      this.logger.warn(`Redis error: ${error.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    if (!this.client) {
      this.logger.warn('REDIS_URL is not configured; cache/realtime are disabled');
      return;
    }
    try {
      if (this.client.status === 'wait') await this.client.connect();
      else if (this.client.status === 'connecting') await this.waitForReady(this.client);
    } catch (error: unknown) {
      this.ready = false;
      this.logger.warn(
        `Redis unavailable; continuing without cache/realtime: ${this.safeMessage(error)}`,
      );
    }
  }

  getClient(): Redis | null {
    return this.client;
  }

  isAvailable(): boolean {
    return this.ready && this.client?.status === 'ready';
  }

  async ping(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      return (await this.client!.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.closing = true;
    if (!this.client || this.client.status === 'end') return;
    try {
      if (this.client.status === 'ready' || this.client.status === 'connecting')
        await this.client.quit();
      else this.client.disconnect();
    } catch (error: unknown) {
      if (!this.safeMessage(error).toLowerCase().includes('closed'))
        this.logger.warn(`Redis cache client close failed: ${this.safeMessage(error)}`);
    }
  }

  private safeMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
  }

  private waitForReady(client: Redis): Promise<void> {
    if (client.status === 'ready') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        client.off('ready', onReady);
        client.off('error', onError);
      };
      client.once('ready', onReady);
      client.once('error', onError);
    });
  }
}
