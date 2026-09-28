process.env.NODE_ENV = 'test';
process.env.SWAGGER_ENABLED = 'false';
process.env.LOG_LEVEL = 'warn';
process.env.REALTIME_REDIS_ADAPTER_ENABLED = 'true';
process.env.BULLMQ_PREFIX = 'queueflow-cross-e2e';
if (process.env.DATABASE_URL_TEST) process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
if (process.env.REDIS_URL_TEST) process.env.REDIS_URL = process.env.REDIS_URL_TEST;
