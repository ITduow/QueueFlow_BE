import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BusinessStatus } from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { BusinessesService } from '../businesses/businesses.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReplaceOpeningHoursDto } from './dto/replace-opening-hours.dto';
import { RedisCacheService } from '../redis/redis-cache.service';
import { RedisKeyFactory } from '../redis/redis-key.factory';

@Injectable()
export class OpeningHoursService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businessesService: BusinessesService,
    private readonly cache?: RedisCacheService,
  ) {}

  async getPublic(businessId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, status: true },
    });
    if (!business || business.status !== BusinessStatus.ACTIVE)
      throw new NotFoundException({ code: 'BUSINESS_NOT_FOUND', message: 'Business not found.' });
    const cacheKey = RedisKeyFactory.businessOpeningHours(businessId);
    const cached = await this.cache?.get<ReturnType<OpeningHoursService['toResponse']>[]>(cacheKey);
    if (cached) return cached;
    const hours = await this.prisma.businessOpeningHour.findMany({
      where: { businessId },
      orderBy: { dayOfWeek: 'asc' },
    });
    const result = hours.map((hour) => this.toResponse(hour));
    await this.cache?.set(cacheKey, result);
    return result;
  }

  async replace(businessId: string, actor: AuthenticatedUser, dto: ReplaceOpeningHoursDto) {
    await this.businessesService.assertManagerAccess(businessId, actor);
    const data = dto.hours.map((hour) => this.toDatabaseInput(hour, dto.hours));
    const result = await this.prisma.$transaction(async (transaction) => {
      await transaction.businessOpeningHour.deleteMany({ where: { businessId } });
      await transaction.businessOpeningHour.createMany({
        data: data.map((hour) => ({ businessId, ...hour })),
      });
      const updated = await transaction.businessOpeningHour.findMany({
        where: { businessId },
        orderBy: { dayOfWeek: 'asc' },
      });
      return updated.map((hour) => this.toResponse(hour));
    });
    await this.cache?.delete(RedisKeyFactory.businessOpeningHours(businessId));
    return result;
  }

  private toDatabaseInput(
    hour: ReplaceOpeningHoursDto['hours'][number],
    allHours: ReplaceOpeningHoursDto['hours'],
  ) {
    const duplicate =
      allHours.filter((candidate) => candidate.dayOfWeek === hour.dayOfWeek).length > 1;
    if (duplicate)
      throw new BadRequestException({
        code: 'OPENING_HOURS_DUPLICATE_DAY',
        message: 'Each day of week may appear only once.',
      });
    if (hour.isClosed)
      return { dayOfWeek: hour.dayOfWeek, openTime: null, closeTime: null, isClosed: true };
    if (!hour.openTime || !hour.closeTime)
      throw new BadRequestException({
        code: 'OPENING_HOURS_INVALID',
        message: 'Open and close times are required for an open day.',
      });
    if (this.toMinutes(hour.openTime) >= this.toMinutes(hour.closeTime))
      throw new BadRequestException({
        code: 'OPENING_HOURS_INVALID',
        message: 'Open time must be before close time.',
      });
    return {
      dayOfWeek: hour.dayOfWeek,
      openTime: this.timeToDate(hour.openTime),
      closeTime: this.timeToDate(hour.closeTime),
      isClosed: false,
    };
  }

  private toResponse(hour: {
    dayOfWeek: number;
    openTime: Date | null;
    closeTime: Date | null;
    isClosed: boolean;
  }) {
    return {
      dayOfWeek: hour.dayOfWeek,
      openTime: hour.openTime ? this.dateToTime(hour.openTime) : null,
      closeTime: hour.closeTime ? this.dateToTime(hour.closeTime) : null,
      isClosed: hour.isClosed,
    };
  }

  private timeToDate(value: string): Date {
    const [hour, minute] = value.split(':').map(Number);
    return new Date(Date.UTC(1970, 0, 1, hour, minute, 0, 0));
  }

  private dateToTime(value: Date): string {
    return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
  }

  private toMinutes(value: string): number {
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
  }
}
