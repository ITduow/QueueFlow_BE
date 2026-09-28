import { Injectable, NotFoundException } from '@nestjs/common';
import { BusinessStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface BusinessLocalDateTime {
  timezone: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async isBusinessOpenAt(businessId: string, instant: Date): Promise<boolean> {
    const local = await this.getBusinessLocalDateTime(businessId, instant);
    const hour = await this.prisma.businessOpeningHour.findUnique({
      where: { uq_business_day: { businessId, dayOfWeek: local.weekday } },
    });
    if (!hour || hour.isClosed || !hour.openTime || !hour.closeTime) return false;
    const currentMinutes = local.hour * 60 + local.minute;
    return (
      currentMinutes >= this.timeToMinutes(hour.openTime) &&
      currentMinutes < this.timeToMinutes(hour.closeTime)
    );
  }

  async isBusinessOpenForInterval(
    businessId: string,
    startTime: Date,
    endTime: Date,
  ): Promise<boolean> {
    if (endTime <= startTime) return false;
    const start = await this.getBusinessLocalDateTime(businessId, startTime);
    const end = await this.getBusinessLocalDateTime(businessId, endTime);
    if (start.year !== end.year || start.month !== end.month || start.day !== end.day) {
      return false;
    }
    const hour = await this.prisma.businessOpeningHour.findUnique({
      where: { uq_business_day: { businessId, dayOfWeek: start.weekday } },
    });
    if (!hour || hour.isClosed || !hour.openTime || !hour.closeTime) return false;
    const startMinutes = start.hour * 60 + start.minute + start.second / 60;
    const endMinutes = end.hour * 60 + end.minute + end.second / 60;
    return (
      startMinutes >= this.timeToMinutes(hour.openTime) &&
      endMinutes <= this.timeToMinutes(hour.closeTime)
    );
  }

  async getBusinessTimezone(businessId: string): Promise<string> {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { timezone: true, status: true },
    });
    if (!business || business.status !== BusinessStatus.ACTIVE)
      throw new NotFoundException({ code: 'BUSINESS_NOT_FOUND', message: 'Business not found.' });
    return business.timezone;
  }

  localDateTimeToInstant(
    timezone: string,
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
  ): Date {
    let instant = new Date(Date.UTC(year, month - 1, day, hour, minute));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const local = this.formatInTimezone(timezone, instant);
      const desired = Date.UTC(year, month - 1, day, hour, minute);
      const observed = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
      instant = new Date(instant.getTime() + desired - observed);
    }
    return instant;
  }

  async getBusinessLocalDateTime(
    businessId: string,
    instant: Date,
  ): Promise<BusinessLocalDateTime> {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { timezone: true, status: true },
    });
    if (!business || business.status !== BusinessStatus.ACTIVE)
      throw new NotFoundException({ code: 'BUSINESS_NOT_FOUND', message: 'Business not found.' });
    const local = this.formatInTimezone(business.timezone, instant);
    const weekdays: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    return {
      timezone: business.timezone,
      year: local.year,
      month: local.month,
      day: local.day,
      hour: local.hour,
      minute: local.minute,
      second: local.second,
      weekday: weekdays[local.weekday],
    };
  }

  calculateServiceEndTime(startTime: Date, durationMinutes: number): Date {
    return new Date(startTime.getTime() + durationMinutes * 60_000);
  }

  private timeToMinutes(value: Date): number {
    return value.getUTCHours() * 60 + value.getUTCMinutes();
  }

  private formatInTimezone(timezone: string, instant: Date) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    }).formatToParts(instant);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    return {
      year: Number(get('year')),
      month: Number(get('month')),
      day: Number(get('day')),
      hour: Number(get('hour')),
      minute: Number(get('minute')),
      second: Number(get('second')),
      weekday: get('weekday'),
    };
  }
}
