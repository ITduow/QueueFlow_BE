import { HealthController } from '../src/health.controller';

describe('HealthController', () => {
  it('returns an ok status', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) } as never;
    const result = await new HealthController(prisma).check();
    expect(result.status).toBe('ok');
    expect(result.database).toBe('connected');
    expect(result.redis).toBe('unavailable');
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
  });
});
