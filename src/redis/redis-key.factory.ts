import { REDIS_KEY_PREFIX } from './redis.constants';

export class RedisKeyFactory {
  static businessById(id: string): string {
    return `${REDIS_KEY_PREFIX}business:id:${id}`;
  }

  static businessBySlug(slug: string): string {
    return `${REDIS_KEY_PREFIX}business:slug:${slug}`;
  }

  static businessServices(businessId: string): string {
    return `${REDIS_KEY_PREFIX}business:${businessId}:services`;
  }

  static businessOpeningHours(businessId: string): string {
    return `${REDIS_KEY_PREFIX}business:${businessId}:opening-hours`;
  }
}
