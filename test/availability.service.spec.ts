import { AvailabilityService } from '../src/services/availability.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('AvailabilityService', () => {
  function serviceFor(hour: { isClosed: boolean; openTime: Date | null; closeTime: Date | null }) {
    const prisma = {
      business: {
        findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Ho_Chi_Minh', status: 'ACTIVE' }),
      },
      businessOpeningHour: { findUnique: jest.fn().mockResolvedValue(hour) },
    } as unknown as PrismaService;
    return new AvailabilityService(prisma);
  }

  it('uses business timezone rather than server timezone', async () => {
    const service = serviceFor({
      isClosed: false,
      openTime: new Date(Date.UTC(1970, 0, 1, 9)),
      closeTime: new Date(Date.UTC(1970, 0, 1, 18)),
    });
    await expect(
      service.isBusinessOpenAt('business-id', new Date('2026-10-05T03:00:00.000Z')),
    ).resolves.toBe(true);
    await expect(
      service.isBusinessOpenAt('business-id', new Date('2026-10-05T01:00:00.000Z')),
    ).resolves.toBe(false);
  });

  it('returns closed for a closed day and calculates service end in UTC instant arithmetic', async () => {
    const service = serviceFor({ isClosed: true, openTime: null, closeTime: null });
    await expect(
      service.isBusinessOpenAt('business-id', new Date('2026-10-04T03:00:00.000Z')),
    ).resolves.toBe(false);
    expect(
      service.calculateServiceEndTime(new Date('2026-10-05T03:00:00.000Z'), 30).toISOString(),
    ).toBe('2026-10-05T03:30:00.000Z');
  });
});
