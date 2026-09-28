import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';

@Injectable()
export class SocketIoRedisAdapterService implements OnApplicationShutdown {
  private readonly logger = new Logger(SocketIoRedisAdapterService.name);
  private readonly enabled: boolean;
  private readonly redisUrl?: string;
  private readonly options: RedisOptions;
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;
  private attached = false;
  private ready = false;
  private closing = false;
  private closePromise: Promise<void> | null = null;

  constructor(private readonly config: ConfigService) {
    this.enabled = this.parseBoolean(config.get('REALTIME_REDIS_ADAPTER_ENABLED', true));
    this.redisUrl = config.get<string>('REDIS_URL');
    this.options = {
      lazyConnect: true,
      connectTimeout: config.get<number>('REDIS_CONNECT_TIMEOUT_MS', 5000),
      maxRetriesPerRequest: null,
      retryStrategy: (times) => (this.closing ? null : Math.min(times * 250, 5000)),
    };
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isReady(): boolean {
    return !this.enabled || this.ready;
  }

  async attach(server: Server): Promise<boolean> {
    if (!this.enabled) {
      this.logger.log('Socket.IO Redis adapter disabled; realtime is instance-local');
      return false;
    }
    if (this.attached) return this.ready;
    if (!this.redisUrl) {
      this.logger.error('Socket.IO Redis adapter enabled but REDIS_URL is not configured');
      return false;
    }
    if (!this.pubClient || !this.subClient) {
      this.pubClient = this.createClient();
      this.subClient = this.createClient();
    }
    try {
      await Promise.all([this.connect(this.pubClient), this.connect(this.subClient)]);
      const adapterHost =
        typeof (server as unknown as { adapter?: unknown }).adapter === 'function'
          ? server
          : ((server as unknown as { server?: Server }).server ?? server);
      (adapterHost as unknown as { adapter: (adapter: unknown) => void }).adapter(
        createAdapter(this.pubClient, this.subClient),
      );
      this.attached = true;
      this.ready = true;
      this.logger.log('Socket.IO Redis adapter enabled');
      return true;
    } catch (error: unknown) {
      this.ready = false;
      this.logger.error(`Socket.IO Redis adapter startup failed: ${this.safeMessage(error)}`);
      await this.closeClients();
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.closing = true;
    await this.closeClients();
  }

  private createClient(): Redis {
    const client = new Redis(this.redisUrl!, this.options);
    client.on('error', (error) => {
      if (!this.closing) this.logger.error(`Socket.IO Redis adapter error: ${error.message}`);
    });
    return client;
  }

  private async connect(client: Redis): Promise<void> {
    if (client.status === 'wait') {
      await client.connect();
      return;
    }
    if (client.status === 'ready') return;
    await new Promise<void>((resolve, reject) => {
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

  private async closeClients(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.ready = false;
    this.closePromise = Promise.all(
      [this.pubClient, this.subClient].map((client) => this.closeClient(client)),
    ).then(() => undefined);
    await this.closePromise;
    this.pubClient = null;
    this.subClient = null;
  }

  private async closeClient(client: Redis | null): Promise<void> {
    if (!client || client.status === 'end') return;
    try {
      if (client.status === 'ready' || client.status === 'connecting') await client.quit();
      else client.disconnect();
    } catch (error: unknown) {
      if (!this.isExpectedCloseError(error))
        this.logger.warn(`Socket.IO Redis client close failed: ${this.safeMessage(error)}`);
    }
  }

  private parseBoolean(value: unknown): boolean {
    return value === true || value === 'true';
  }

  private isExpectedCloseError(error: unknown): boolean {
    const message = this.safeMessage(error).toLowerCase();
    return message.includes('already closed') || message.includes('connection is closed');
  }

  private safeMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
  }
}
