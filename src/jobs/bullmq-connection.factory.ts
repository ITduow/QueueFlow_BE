import { ConfigService } from '@nestjs/config';

export interface BullMqConnectionOptions {
  url: string;
  maxRetriesPerRequest: null;
}

export function createBullMqConnection(config: ConfigService): BullMqConnectionOptions | null {
  const url = config.get<string>('REDIS_URL');
  return url ? { url, maxRetriesPerRequest: null } : null;
}
