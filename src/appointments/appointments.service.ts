import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentStatus, Prisma, UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { BusinessesService } from '../businesses/businesses.service';
import { AvailabilityService } from '../services/availability.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppointmentTransitionService, appointmentSelect } from './appointment-transition.service';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { ListBusinessAppointmentsQueryDto } from './dto/list-business-appointments-query.dto';
import { ListMyAppointmentsQueryDto } from './dto/list-my-appointments-query.dto';
import { Optional } from '@nestjs/common';
import { NotificationQueue } from '../jobs/notification/notification.queue';
import { NotificationJobFactory } from '../notifications/notification-job.factory';

const activeStatuses = [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED];

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly businessesService: BusinessesService,
    private readonly availability: AvailabilityService,
    private readonly transitions: AppointmentTransitionService,
    @Optional() private readonly notificationQueue?: NotificationQueue,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateAppointmentDto) {
    if (!actor.isActive)
      throw new ForbiddenException({ code: 'AUTH_FORBIDDEN', message: 'User is inactive.' });
    const business = await this.prisma.business.findUnique({
      where: { id: dto.businessId },
      select: { id: true, status: true },
    });
    if (!business || business.status !== 'ACTIVE')
      throw new ConflictException({
        code: 'APPOINTMENT_BUSINESS_INACTIVE',
        message: 'Appointments are unavailable for this business.',
      });
    const service = await this.prisma.service.findUnique({
      where: { id: dto.serviceId },
      select: { id: true, businessId: true, isActive: true, durationMinutes: true },
    });
    if (!service)
      throw new NotFoundException({ code: 'SERVICE_NOT_FOUND', message: 'Service not found.' });
    if (service.businessId !== business.id)
      throw new BadRequestException({
        code: 'APPOINTMENT_SERVICE_BUSINESS_MISMATCH',
        message: 'Service does not belong to the selected business.',
      });
    if (!service.isActive)
      throw new ConflictException({
        code: 'APPOINTMENT_SERVICE_INACTIVE',
        message: 'The selected service is inactive.',
      });

    const startTime = new Date(dto.startTime);
    if (Number.isNaN(startTime.getTime()) || startTime <= new Date())
      throw new BadRequestException({
        code: 'APPOINTMENT_IN_PAST',
        message: 'Appointment start time must be in the future.',
      });
    const endTime = this.availability.calculateServiceEndTime(startTime, service.durationMinutes);
    if (!(await this.availability.isBusinessOpenForInterval(dto.businessId, startTime, endTime)))
      throw new ConflictException({
        code: 'APPOINTMENT_OUTSIDE_OPENING_HOURS',
        message: 'The selected time is outside business opening hours.',
      });
    await this.assertNoOverlap('serviceId', service.id, startTime, endTime);
    await this.assertNoOverlap('customerId', actor.id, startTime, endTime);

    try {
      return await this.prisma.appointment.create({
        data: {
          customerId: actor.id,
          businessId: business.id,
          serviceId: service.id,
          startTime,
          endTime,
          status: AppointmentStatus.PENDING,
          customerNote: dto.customerNote?.trim() || null,
        },
        select: appointmentSelect,
      });
    } catch (error: unknown) {
      const conflictCode = this.exclusionConflictCode(error);
      if (conflictCode)
        throw new ConflictException({
          code: conflictCode,
          message: 'The selected time slot is no longer available.',
        });
      this.logger.error(
        `Appointment create failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      throw error;
    }
  }

  async listMine(actor: AuthenticatedUser, query: ListMyAppointmentsQueryDto) {
    const where: Prisma.AppointmentWhereInput = {
      customerId: actor.id,
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            startTime: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.appointment.findMany({
        where,
        select: appointmentSelect,
        orderBy: { startTime: query.sortOrder },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.appointment.count({ where }),
    ]);
    return {
      data,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async listBusiness(
    businessId: string,
    actor: AuthenticatedUser,
    query: ListBusinessAppointmentsQueryDto,
  ) {
    await this.assertBusinessOperator(businessId, actor);
    const where: Prisma.AppointmentWhereInput = {
      businessId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.serviceId ? { serviceId: query.serviceId } : {}),
      ...(query.from || query.to
        ? {
            startTime: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.appointment.findMany({
        where,
        select: appointmentSelect,
        orderBy: { startTime: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.appointment.count({ where }),
    ]);
    return {
      data,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async getById(id: string, actor: AuthenticatedUser) {
    const appointment = await this.findOrThrow(id);
    const access = await this.getAccess(appointment, actor);
    if (!access.isAdmin && !access.isCustomer && !access.isBusinessOperator)
      throw new ForbiddenException({
        code: 'APPOINTMENT_ACCESS_DENIED',
        message: 'Appointment access denied.',
      });
    return appointment;
  }

  async cancel(id: string, actor: AuthenticatedUser, dto: CancelAppointmentDto) {
    const appointment = await this.findOrThrow(id);
    const access = await this.getAccess(appointment, actor);
    if (!access.isAdmin && !access.isCustomer && !access.isBusinessOperator)
      throw new ForbiddenException({
        code: 'APPOINTMENT_ACCESS_DENIED',
        message: 'Appointment access denied.',
      });
    const result = await this.transitions
      .transition(
        id,
        AppointmentStatus.PENDING,
        AppointmentStatus.CANCELLED,
        dto.reason?.trim() || null,
      )
      .catch((error: unknown) => {
        if (!(error instanceof ConflictException)) throw error;
        return this.transitions.transition(
          id,
          AppointmentStatus.CONFIRMED,
          AppointmentStatus.CANCELLED,
          dto.reason?.trim() || null,
        );
      });
    await this.notificationQueue?.enqueueBestEffort(
      NotificationJobFactory.bookingCancelled(result.customerId, result.id),
    );
    return result;
  }

  async confirm(id: string, actor: AuthenticatedUser) {
    const appointment = await this.findOrThrow(id);
    await this.assertBusinessOperator(appointment.businessId, actor);
    const result = await this.transitions.transition(
      id,
      AppointmentStatus.PENDING,
      AppointmentStatus.CONFIRMED,
    );
    await this.notificationQueue?.enqueueBestEffort(
      NotificationJobFactory.bookingConfirmed(result.customerId, result.id),
    );
    return result;
  }

  async complete(id: string, actor: AuthenticatedUser) {
    const appointment = await this.findOrThrow(id);
    await this.assertBusinessOperator(appointment.businessId, actor);
    return this.transitions.transition(
      id,
      AppointmentStatus.CONFIRMED,
      AppointmentStatus.COMPLETED,
    );
  }

  async noShow(id: string, actor: AuthenticatedUser) {
    const appointment = await this.findOrThrow(id);
    await this.assertBusinessOperator(appointment.businessId, actor);
    return this.transitions.transition(id, AppointmentStatus.CONFIRMED, AppointmentStatus.NO_SHOW);
  }

  async getAvailability(businessId: string, serviceId: string, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new BadRequestException({
        code: 'AVAILABILITY_DATE_INVALID',
        message: 'Date must use YYYY-MM-DD.',
      });
    const service = await this.prisma.service.findUnique({
      where: { id: serviceId },
      select: {
        id: true,
        businessId: true,
        isActive: true,
        durationMinutes: true,
        business: { select: { status: true, timezone: true } },
      },
    });
    if (!service || service.businessId !== businessId)
      throw new NotFoundException({ code: 'SERVICE_NOT_FOUND', message: 'Service not found.' });
    if (service.business.status !== 'ACTIVE')
      throw new NotFoundException({ code: 'BUSINESS_NOT_FOUND', message: 'Business not found.' });
    if (!service.isActive)
      throw new NotFoundException({ code: 'SERVICE_NOT_FOUND', message: 'Service not found.' });
    const [year, month, day] = date.split('-').map(Number);
    const noon = this.availability.localDateTimeToInstant(
      service.business.timezone,
      year,
      month,
      day,
      12,
      0,
    );
    const localNoon = await this.availability.getBusinessLocalDateTime(businessId, noon);
    if (localNoon.year !== year || localNoon.month !== month || localNoon.day !== day)
      throw new BadRequestException({
        code: 'AVAILABILITY_DATE_INVALID',
        message: 'Date is not valid in the business timezone.',
      });
    const opening = await this.prisma.businessOpeningHour.findUnique({
      where: { uq_business_day: { businessId, dayOfWeek: localNoon.weekday } },
    });
    if (!opening || opening.isClosed || !opening.openTime || !opening.closeTime)
      return {
        date,
        timezone: service.business.timezone,
        serviceId,
        durationMinutes: service.durationMinutes,
        slots: [],
      };
    const openMinutes = opening.openTime.getUTCHours() * 60 + opening.openTime.getUTCMinutes();
    const closeMinutes = opening.closeTime.getUTCHours() * 60 + opening.closeTime.getUTCMinutes();
    const dayStart = this.availability.localDateTimeToInstant(
      service.business.timezone,
      year,
      month,
      day,
      0,
      0,
    );
    const dayEnd = this.availability.localDateTimeToInstant(
      service.business.timezone,
      year,
      month,
      day + 1,
      0,
      0,
    );
    const existing = await this.prisma.appointment.findMany({
      where: {
        serviceId,
        status: { in: activeStatuses },
        startTime: { lt: dayEnd },
        endTime: { gt: dayStart },
      },
      select: { startTime: true, endTime: true },
    });
    const slots: Array<{ startTime: string; endTime: string }> = [];
    for (let minute = openMinutes; minute + service.durationMinutes <= closeMinutes; minute += 15) {
      const slotStart = this.availability.localDateTimeToInstant(
        service.business.timezone,
        year,
        month,
        day,
        Math.floor(minute / 60),
        minute % 60,
      );
      const slotEnd = this.availability.calculateServiceEndTime(slotStart, service.durationMinutes);
      if (
        slotStart <= new Date() ||
        existing.some((item) => item.startTime < slotEnd && item.endTime > slotStart)
      )
        continue;
      slots.push({ startTime: slotStart.toISOString(), endTime: slotEnd.toISOString() });
    }
    return {
      date,
      timezone: service.business.timezone,
      serviceId,
      durationMinutes: service.durationMinutes,
      slots,
    };
  }

  private async findOrThrow(id: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      select: appointmentSelect,
    });
    if (!appointment)
      throw new NotFoundException({
        code: 'APPOINTMENT_NOT_FOUND',
        message: 'Appointment not found.',
      });
    return appointment;
  }

  private async getAccess(
    appointment: { customerId: string; businessId: string },
    actor: AuthenticatedUser,
  ) {
    const businessAccess = await this.businessesService.getAccess(appointment.businessId, actor);
    return {
      isAdmin: actor.role === UserRole.ADMIN,
      isCustomer: appointment.customerId === actor.id,
      isBusinessOperator:
        businessAccess.isAdmin || businessAccess.isOwner || businessAccess.membershipRole !== null,
    };
  }

  private async assertBusinessOperator(businessId: string, actor: AuthenticatedUser) {
    const access = await this.businessesService.getAccess(businessId, actor);
    if (!access.isAdmin && !access.isOwner && !access.membershipRole)
      throw new ForbiddenException({
        code: 'APPOINTMENT_ACCESS_DENIED',
        message: 'Business appointment access denied.',
      });
  }

  private async assertNoOverlap(
    field: 'serviceId' | 'customerId',
    value: string,
    startTime: Date,
    endTime: Date,
  ) {
    const where = {
      [field]: value,
      status: { in: activeStatuses },
      startTime: { lt: endTime },
      endTime: { gt: startTime },
    } as Prisma.AppointmentWhereInput;
    const existing = await this.prisma.appointment.findFirst({ where, select: { id: true } });
    if (existing)
      throw new ConflictException({
        code:
          field === 'customerId'
            ? 'APPOINTMENT_CUSTOMER_TIME_CONFLICT'
            : 'APPOINTMENT_TIME_CONFLICT',
        message: 'The selected time slot is no longer available.',
      });
  }

  private exclusionConflictCode(
    error: unknown,
  ): 'APPOINTMENT_TIME_CONFLICT' | 'APPOINTMENT_CUSTOMER_TIME_CONFLICT' | null {
    let message = '';
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const meta = JSON.stringify(error.meta ?? {});
      message = `${meta} ${error.message}`;
    } else if (error instanceof Error) {
      message = error.message;
    } else {
      return null;
    }
    const normalized = message.toLowerCase();
    if (
      !normalized.includes('23p01') &&
      !normalized.includes('exclusion') &&
      !normalized.includes('conflicting key value') &&
      !normalized.includes('appointments_no_active_') &&
      !normalized.includes('uq_active_service_booking') &&
      !normalized.includes('uq_active_customer_booking')
    )
      return null;
    return normalized.includes('customer')
      ? 'APPOINTMENT_CUSTOMER_TIME_CONFLICT'
      : 'APPOINTMENT_TIME_CONFLICT';
  }
}
