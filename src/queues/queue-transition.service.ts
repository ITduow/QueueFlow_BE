import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, QueueEntryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const queueEntrySelect = {
  id: true,
  queueId: true,
  customerId: true,
  serviceId: true,
  queueNumber: true,
  status: true,
  joinedAt: true,
  calledAt: true,
  servingAt: true,
  completedAt: true,
  estimatedWaitMinutes: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { id: true, fullName: true } },
  service: { select: { id: true, name: true, durationMinutes: true } },
} satisfies Prisma.QueueEntrySelect;

@Injectable()
export class QueueTransitionService {
  constructor(private readonly prisma: PrismaService) {}

  async transition(
    id: string,
    expected: QueueEntryStatus,
    target: QueueEntryStatus,
    timestamp?: 'calledAt' | 'servingAt' | 'completedAt',
  ) {
    const result = await this.prisma.queueEntry.updateMany({
      where: { id, status: expected },
      data: {
        status: target,
        ...(timestamp ? { [timestamp]: new Date() } : {}),
      },
    });
    if (result.count !== 1) {
      const entry = await this.prisma.queueEntry.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!entry)
        throw new NotFoundException({
          code: 'QUEUE_ENTRY_NOT_FOUND',
          message: 'Queue entry not found.',
        });
      throw new ConflictException({
        code: 'QUEUE_INVALID_STATE',
        message: 'Queue entry is not in a valid state for this transition.',
      });
    }
    return this.prisma.queueEntry.findUniqueOrThrow({ where: { id }, select: queueEntrySelect });
  }

  async transitionFrom(id: string, expected: QueueEntryStatus[], target: QueueEntryStatus) {
    for (const status of expected) {
      try {
        return await this.transition(id, status, target);
      } catch (error: unknown) {
        if (!(error instanceof ConflictException)) throw error;
      }
    }
    throw new ConflictException({
      code: 'QUEUE_INVALID_STATE',
      message: 'Queue entry is not in a valid state for this transition.',
    });
  }
}
