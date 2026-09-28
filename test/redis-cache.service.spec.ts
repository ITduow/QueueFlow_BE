import { ConfigService } from '@nestjs/config';
import { RedisCacheService } from '../src/redis/redis-cache.service';
import { RedisService } from '../src/redis/redis.service';

describe('RedisCacheService', () => {
  it('serializes values and applies the configured TTL', async () => {
    const set = jest.fn().mockResolvedValue('OK');
    const client = { set };
    const redis = {
      isAvailable: jest.fn().mockReturnValue(true),
      getClient: jest.fn().mockReturnValue(client),
    } as unknown as RedisService;
    const config = { get: jest.fn().mockReturnValue(60) } as unknown as ConfigService;
    const cache = new RedisCacheService(redis, config);

    await cache.set('queueflow:key', { value: 1 });

    expect(set).toHaveBeenCalledWith('queueflow:key', '{"value":1}', 'EX', 60);
  });

  it('fails open when Redis is unavailable', async () => {
    const redis = {
      isAvailable: jest.fn().mockReturnValue(false),
      getClient: jest.fn().mockReturnValue(null),
    } as unknown as RedisService;
    const cache = new RedisCacheService(redis, {
      get: jest.fn().mockReturnValue(300),
    } as unknown as ConfigService);

    await expect(cache.get('queueflow:key')).resolves.toBeNull();
    await expect(cache.delete('queueflow:key')).resolves.toBeUndefined();
  });
});
