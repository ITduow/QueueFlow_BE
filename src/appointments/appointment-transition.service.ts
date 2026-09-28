import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AppointmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AppointmentTransitionService {
  constructor(private readonly prisma: PrismaService) {}

  async transition(
    id: string,
    expected: AppointmentStatus,
    target: AppointmentStatus,
    cancellationReason?: string | null,
  ) {
    const result = await this.prisma.appointment.updateMany({
      where: { id, status: expected },
      data: {
        status: target,
        ...(target === AppointmentStatus.CANCELLED
          ? { cancellationReason: cancellationReason ?? null }
          : {}),
      },
    });
    if (result.count !== 1) {
      const existing = await this.prisma.appointment.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing)
        throw new NotFoundException({
          code: 'APPOINTMENT_NOT_FOUND',
          message: 'Appointment not found.',
        });
      throw new ConflictException({
        code: 'APPOINTMENT_INVALID_STATE',
        message: 'Appointment is not in a valid state for this transition.',
      });
    }
    return this.prisma.appointment.findUniqueOrThrow({
      where: { id },
      select: appointmentSelect,
    });
  }
}

export const appointmentSelect = {
  id: true,
  customerId: true,
  businessId: true,
  serviceId: true,
  startTime: true,
  endTime: true,
  status: true,
  customerNote: true,
  cancellationReason: true,
  createdAt: true,
  updatedAt: true,
  business: { select: { id: true, name: true, slug: true, timezone: true } },
  service: { select: { id: true, name: true, durationMinutes: true, price: true } },
} satisfies Prisma.AppointmentSelect;
