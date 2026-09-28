import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  environment: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  prefix: process.env.API_PREFIX ?? 'api',
  version: process.env.API_VERSION ?? '1',
  corsOrigin: process.env.CORS_ORIGIN ?? '',
  swaggerEnabled: process.env.SWAGGER_ENABLED === 'true',
}));
