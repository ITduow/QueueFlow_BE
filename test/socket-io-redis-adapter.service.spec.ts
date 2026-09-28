import { ConfigService } from '@nestjs/config';
import { SocketIoRedisAdapterService } from '../src/realtime/socket-io-redis-adapter.service';

describe('SocketIoRedisAdapterService', () => {
  it('does not create pub/sub clients when disabled and shutdown is idempotent', async () => {
    const config = {
      get: jest.fn((key: string, fallback?: unknown) =>
        key === 'REALTIME_REDIS_ADAPTER_ENABLED' ? false : fallback,
      ),
    } as unknown as ConfigService;
    const service = new SocketIoRedisAdapterService(config);

    await expect(service.attach({} as never)).resolves.toBe(false);
    expect(service.isEnabled()).toBe(false);
    expect(service.isReady()).toBe(true);
    await expect(service.onApplicationShutdown()).resolves.toBeUndefined();
    await expect(service.onApplicationShutdown()).resolves.toBeUndefined();
  });

  it('reports enabled adapter as not ready when Redis is not configured', async () => {
    const config = {
      get: jest.fn((key: string, fallback?: unknown) =>
        key === 'REALTIME_REDIS_ADAPTER_ENABLED' ? true : fallback,
      ),
    } as unknown as ConfigService;
    const service = new SocketIoRedisAdapterService(config);

    await expect(service.attach({} as never)).resolves.toBe(false);
    expect(service.isReady()).toBe(false);
    await service.onApplicationShutdown();
  });
});
