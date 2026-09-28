import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  API_PREFIX: Joi.string().default('api'),
  API_VERSION: Joi.string().default('1'),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string()
    .pattern(/^\d+[smhdw]$/)
    .default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string()
    .pattern(/^\d+[smhdw]$/)
    .default('7d'),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .optional(),
  REDIS_CONNECT_TIMEOUT_MS: Joi.number().integer().min(100).default(5000),
  REDIS_CACHE_DEFAULT_TTL_SECONDS: Joi.number().integer().min(1).default(300),
  REALTIME_REDIS_ADAPTER_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),
  BULLMQ_PREFIX: Joi.string().min(1).max(100).default('queueflow'),
  NOTIFICATION_JOB_ATTEMPTS: Joi.number().integer().min(1).max(20).default(5),
  NOTIFICATION_JOB_BACKOFF_MS: Joi.number().integer().min(100).max(600000).default(1000),
  CORS_ORIGIN: Joi.string().required(),
  BCRYPT_ROUNDS: Joi.number().integer().min(10).max(15).default(12),
  LOG_LEVEL: Joi.string().valid('fatal', 'error', 'warn', 'info', 'debug', 'trace').default('info'),
  SWAGGER_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  COOKIE_SECURE: Joi.boolean().truthy('true').falsy('false').default(false),
  COOKIE_SAME_SITE: Joi.string().valid('lax', 'strict', 'none').default('lax'),
  COOKIE_DOMAIN: Joi.string().allow('').default(''),
  // Platform runtimes add their own environment variables (for example PATH,
  // PORT metadata, and service identity). Validate QueueFlow's settings without
  // rejecting unrelated process-level variables.
}).unknown(true);
