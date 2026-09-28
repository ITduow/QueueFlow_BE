import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, QueueEntryStatus, UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { BusinessesService } from '../businesses/businesses.service';
import { PrismaService } from '../prisma/prisma.service';
import { AvailabilityService } from '../services/availability.service';
import { CreateQueueDto } from './dto/create-queue.dto';
import { JoinQueueDto } from './dto/join-queue.dto';
import { ListQueueEntriesQueryDto } from './dto/list-queue-entries-query.dto';
import { QueueTransitionService, queueEntrySelect } from './queue-transition.service';
import { QueueWaitTimeService } from './queue-wait-time.service';
import { formatQueueNumber } from './utils/queue-number.util';
import { Optional } from '@nestjs/common';
import { RealtimeEvents } from '../realtime/realtime-events';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationQueue } from '../jobs/notification/notification.queue';
import { NotificationJobFactory } from '../notifications/notification-job.factory';

const activeEntryStatuses = [
  QueueEntryStatus.WAITING,
  QueueEntryStatus.CALLED,
  QueueEntryStatus.SERVING,
];

const queueSelect = {
  id: true,
  businessId: true,
  queueDate: true,
  name: true,
  isActive: true,
  lastQueueNumber: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.QueueSelect;

@Injectable()
export class QueuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businesses: BusinessesService,
    private readonly availability: AvailabilityService,
    private readonly transitions: QueueTransitionService,
    private readonly waitTime: QueueWaitTimeService,
    @Optional() private readonly realtime?: RealtimeService,
    @Optional() private readonly notificationQueue?: NotificationQueue,
  ) {}

  async create(businessId: string, actor: AuthenticatedUser, dto: CreateQueueDto) {
    await this.assertManagerAccess(businessId, actor);
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, status: true },
    });
    if (!business || business.status !== 'ACTIVE')
      throw new ConflictException({ code: 'QUEUE_CLOSED', message: 'Business is not active.' });
    const queueDate = await this.currentQueueDate(businessId);
    try {
      return await this.prisma.queue.create({
        data: { businessId, queueDate, name: dto.name?.trim() || 'Main Queue' },
        select: queueSelect,
      });
    } catch (error: unknown) {
      if (this.isUniqueViolation(error))
        throw new ConflictException({
          code: 'QUEUE_ALREADY_EXISTS',
          message: 'A queue with this name already exists for the business date.',
        });
      throw error;
    }
  }

  async currentPublic(businessId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, status: true },
    });
    if (!business || business.status !== 'ACTIVE')
      throw new NotFoundException({ code: 'BUSINESS_NOT_FOUND', message: 'Business not found.' });
    const queueDate = await this.currentQueueDate(businessId);
    const queues = await this.prisma.queue.findMany({
      where: { businessId, queueDate, isActive: true },
      select: {
        id: true,
        name: true,
        queueDate: true,
        isActive: true,
        entries: {
          where: { status: { in: activeEntryStatuses } },
          select: { queueNumber: true, status: true },
          orderBy: { queueNumber: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });
    return queues.map((queue) => {
      const servingNumber =
        queue.entries.find((entry) => entry.status === QueueEntryStatus.SERVING)?.queueNumber ??
        queue.entries.find((entry) => entry.status === QueueEntryStatus.CALLED)?.queueNumber ??
        null;
      return {
        id: queue.id,
        name: queue.name,
        queueDate: this.dateOnly(queue.queueDate),
        isActive: queue.isActive,
        waitingCount: queue.entries.filter((entry) => entry.status === QueueEntryStatus.WAITING)
          .length,
        currentlyServing: servingNumber === null ? null : formatQueueNumber(servingNumber),
      };
    });
  }

  async join(queueId: string, actor: AuthenticatedUser, dto: JoinQueueDto) {
    if (!actor.isActive)
      throw new ForbiddenException({ code: 'AUTH_FORBIDDEN', message: 'User is inactive.' });
    const queue = await this.prisma.queue.findUnique({
      where: { id: queueId },
      select: {
        id: true,
        businessId: true,
        queueDate: true,
        isActive: true,
        business: { select: { status: true } },
      },
    });
    if (!queue)
      throw new NotFoundException({ code: 'QUEUE_NOT_FOUND', message: 'Queue not found.' });
    if (!queue.isActive || queue.business.status !== 'ACTIVE')
      throw new ConflictException({ code: 'QUEUE_CLOSED', message: 'Queue is not active.' });
    const currentDate = await this.currentQueueDate(queue.businessId);
    if (this.dateOnly(queue.queueDate) !== this.dateOnly(currentDate))
      throw new ConflictException({ code: 'QUEUE_NOT_CURRENT', message: 'Queue is not current.' });
    const service = await this.prisma.service.findUnique({
      where: { id: dto.serviceId },
      select: { id: true, businessId: true, isActive: true },
    });
    if (!service)
      throw new NotFoundException({
        code: 'QUEUE_SERVICE_NOT_FOUND',
        message: 'Service not found.',
      });
    if (service.businessId !== queue.businessId)
      throw new ConflictException({
        code: 'QUEUE_SERVICE_BUSINESS_MISMATCH',
        message: 'Service does not belong to this queue business.',
      });
    if (!service.isActive)
      throw new ConflictException({
        code: 'QUEUE_SERVICE_INACTIVE',
        message: 'Service is inactive.',
      });
    const activeEntry = await this.prisma.queueEntry.findFirst({
      where: { queueId, customerId: actor.id, status: { in: activeEntryStatuses } },
      select: { id: true },
    });
    if (activeEntry)
      throw new ConflictException({
        code: 'QUEUE_ALREADY_JOINED',
        message: 'Customer already joined this queue.',
      });
    const completed = await this.prisma.queueEntry.findFirst({
      where: { queueId, customerId: actor.id, status: QueueEntryStatus.COMPLETED },
      select: { id: true },
    });
    if (completed)
      throw new ConflictException({
        code: 'QUEUE_ALREADY_COMPLETED',
        message: 'Customer already completed this queue.',
      });

    try {
      const entry = await this.prisma.$transaction(async (transaction) => {
        const updatedQueue = await transaction.queue.update({
          where: { id: queueId },
          data: { lastQueueNumber: { increment: 1 } },
          select: { lastQueueNumber: true },
        });
        return transaction.queueEntry.create({
          data: {
            queueId,
            customerId: actor.id,
            serviceId: dto.serviceId,
            queueNumber: updatedQueue.lastQueueNumber,
            status: QueueEntryStatus.WAITING,
          },
          select: queueEntrySelect,
        });
      });
      const estimate = await this.waitTime.calculateForEntry(queueId, entry.queueNumber);
      await this.prisma.queueEntry.update({
        where: { id: entry.id },
        data: { estimatedWaitMinutes: estimate },
      });
      await this.emitEntryEvent(RealtimeEvents.queueJoined, entry);
      await this.notificationQueue?.enqueueBestEffort(
        NotificationJobFactory.queueJoined(
          entry.customerId,
          entry.queueId,
          entry.id,
          formatQueueNumber(entry.queueNumber),
        ),
      );
      return this.toEntryResponse(entry, estimate);
    } catch (error: unknown) {
      if (this.isUniqueViolation(error))
        throw new ConflictException({
          code: 'QUEUE_ALREADY_JOINED',
          message: 'Customer already joined this queue.',
        });
      throw error;
    }
  }

  async leave(queueId: string, actor: AuthenticatedUser) {
    const entry = await this.prisma.queueEntry.findFirst({
      where: {
        queueId,
        customerId: actor.id,
        status: { in: [QueueEntryStatus.WAITING, QueueEntryStatus.CALLED] },
      },
      select: { id: true },
    });
    if (!entry)
      throw new NotFoundException({
        code: 'QUEUE_ENTRY_NOT_FOUND',
        message: 'Active queue entry not found.',
      });
    const result = await this.transitions.transitionFrom(
      entry.id,
      [QueueEntryStatus.WAITING, QueueEntryStatus.CALLED],
      QueueEntryStatus.CANCELLED,
    );
    await this.emitEntryEvent(RealtimeEvents.queueCancelled, result);
    return result;
  }

  async status(queueId: string, actor: AuthenticatedUser) {
    const entry = await this.prisma.queueEntry.findFirst({
      where: { queueId, customerId: actor.id, status: { in: activeEntryStatuses } },
      select: { id: true, queueId: true, queueNumber: true, status: true },
      orderBy: { queueNumber: 'asc' },
    });
    if (!entry)
      throw new NotFoundException({
        code: 'QUEUE_ENTRY_NOT_FOUND',
        message: 'Active queue entry not found.',
      });
    const [peopleAhead, estimatedWaitMinutes, currentlyServing] = await Promise.all([
      this.prisma.queueEntry.count({
        where: {
          queueId,
          queueNumber: { lt: entry.queueNumber },
          status: { in: activeEntryStatuses },
        },
      }),
      this.waitTime.calculateForEntry(queueId, entry.queueNumber),
      this.waitTime.currentServing(queueId),
    ]);
    return {
      queueId,
      entryId: entry.id,
      queueNumber: formatQueueNumber(entry.queueNumber),
      status: entry.status,
      peopleAhead,
      estimatedWaitMinutes,
      currentlyServing: currentlyServing === null ? null : formatQueueNumber(currentlyServing),
    };
  }

  async entries(queueId: string, actor: AuthenticatedUser, query: ListQueueEntriesQueryDto) {
    await this.assertOperatorForQueue(queueId, actor);
    const where: Prisma.QueueEntryWhereInput = {
      queueId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.queueEntry.findMany({
        where,
        select: queueEntrySelect,
        orderBy: { queueNumber: query.sortOrder },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.queueEntry.count({ where }),
    ]);
    return {
      data: data.map((entry) => this.toEntryResponse(entry, entry.estimatedWaitMinutes ?? 0)),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async next(queueId: string, actor: AuthenticatedUser) {
    await this.assertOperatorForQueue(queueId, actor);
    await this.assertQueueActive(queueId);
    const entry = await this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM "queue_entries"
        WHERE "queue_id" = ${queueId}::uuid
          AND "status" = 'WAITING'::"queue_entry_status"
        ORDER BY "queue_number" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
      if (rows.length === 0)
        throw new ConflictException({
          code: 'QUEUE_EMPTY',
          message: 'No waiting entries are available.',
        });
      const result = await transaction.queueEntry.updateMany({
        where: { id: rows[0].id, status: QueueEntryStatus.WAITING },
        data: { status: QueueEntryStatus.CALLED, calledAt: new Date() },
      });
      if (result.count !== 1)
        throw new ConflictException({
          code: 'QUEUE_EMPTY',
          message: 'No waiting entries are available.',
        });
      return transaction.queueEntry.findUniqueOrThrow({
        where: { id: rows[0].id },
        select: queueEntrySelect,
      });
    });
    await this.emitEntryEvent(RealtimeEvents.queueCalled, entry);
    await this.enqueueCalledNotification(entry);
    return entry;
  }

  async call(entryId: string, actor: AuthenticatedUser) {
    await this.assertOperatorForEntry(entryId, actor);
    const result = await this.transitions.transition(
      entryId,
      QueueEntryStatus.WAITING,
      QueueEntryStatus.CALLED,
      'calledAt',
    );
    await this.emitEntryEvent(RealtimeEvents.queueCalled, result);
    await this.enqueueCalledNotification(result);
    return result;
  }

  async serve(entryId: string, actor: AuthenticatedUser) {
    await this.assertOperatorForEntry(entryId, actor);
    const result = await this.transitions.transition(
      entryId,
      QueueEntryStatus.CALLED,
      QueueEntryStatus.SERVING,
      'servingAt',
    );
    await this.emitEntryEvent(RealtimeEvents.queueServing, result);
    return result;
  }

  async complete(entryId: string, actor: AuthenticatedUser) {
    await this.assertOperatorForEntry(entryId, actor);
    const result = await this.transitions.transition(
      entryId,
      QueueEntryStatus.SERVING,
      QueueEntryStatus.COMPLETED,
      'completedAt',
    );
    await this.emitEntryEvent(RealtimeEvents.queueCompleted, result);
    return result;
  }

  async skip(entryId: string, actor: AuthenticatedUser) {
    await this.assertOperatorForEntry(entryId, actor);
    const result = await this.transitions.transitionFrom(
      entryId,
      [QueueEntryStatus.WAITING, QueueEntryStatus.CALLED],
      QueueEntryStatus.SKIPPED,
    );
    await this.emitEntryEvent(RealtimeEvents.queueSkipped, result);
    return result;
  }

  private async currentQueueDate(businessId: string): Promise<Date> {
    const local = await this.availability.getBusinessLocalDateTime(businessId, new Date());
    return new Date(Date.UTC(local.year, local.month - 1, local.day));
  }

  private dateOnly(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private async assertManagerAccess(businessId: string, actor: AuthenticatedUser) {
    const access = await this.businesses.getAccess(businessId, actor);
    if (!access.isAdmin && !access.isOwner && access.membershipRole !== UserRole.MANAGER)
      throw new ForbiddenException({
        code: 'QUEUE_ACCESS_DENIED',
        message: 'Queue management access denied.',
      });
  }

  private async assertOperatorForQueue(queueId: string, actor: AuthenticatedUser) {
    const queue = await this.prisma.queue.findUnique({
      where: { id: queueId },
      select: { businessId: true },
    });
    if (!queue)
      throw new NotFoundException({ code: 'QUEUE_NOT_FOUND', message: 'Queue not found.' });
    const access = await this.businesses.getAccess(queue.businessId, actor);
    if (!access.isAdmin && !access.isOwner && !access.membershipRole)
      throw new ForbiddenException({
        code: 'QUEUE_ENTRY_ACCESS_DENIED',
        message: 'Queue operation access denied.',
      });
  }

  private async assertOperatorForEntry(entryId: string, actor: AuthenticatedUser) {
    const entry = await this.prisma.queueEntry.findUnique({
      where: { id: entryId },
      select: { queue: { select: { businessId: true } } },
    });
    if (!entry)
      throw new NotFoundException({
        code: 'QUEUE_ENTRY_NOT_FOUND',
        message: 'Queue entry not found.',
      });
    const access = await this.businesses.getAccess(entry.queue.businessId, actor);
    if (!access.isAdmin && !access.isOwner && !access.membershipRole)
      throw new ForbiddenException({
        code: 'QUEUE_ENTRY_ACCESS_DENIED',
        message: 'Queue operation access denied.',
      });
  }

  private async assertQueueActive(queueId: string) {
    const queue = await this.prisma.queue.findUnique({
      where: { id: queueId },
      select: { isActive: true },
    });
    if (!queue)
      throw new NotFoundException({ code: 'QUEUE_NOT_FOUND', message: 'Queue not found.' });
    if (!queue.isActive)
      throw new ConflictException({ code: 'QUEUE_CLOSED', message: 'Queue is closed.' });
  }

  private toEntryResponse(
    entry: { queueNumber: number; [key: string]: unknown },
    estimate: number,
  ) {
    return {
      ...entry,
      formattedQueueNumber: formatQueueNumber(entry.queueNumber),
      estimatedWaitMinutes: estimate,
    };
  }

  private async emitEntryEvent(
    event: (typeof RealtimeEvents)[keyof typeof RealtimeEvents],
    entry: {
      id: string;
      queueId: string;
      customerId: string;
      queueNumber: number;
      status: QueueEntryStatus;
    },
  ): Promise<void> {
    if (!this.realtime) return;
    const queue = await this.prisma.queue.findUnique({
      where: { id: entry.queueId },
      select: { businessId: true },
    });
    this.realtime.emitQueueMutation({
      event,
      queueId: entry.queueId,
      businessId: queue?.businessId,
      userId: entry.customerId,
      payload: {
        queueId: entry.queueId,
        entryId: entry.id,
        queueNumber: formatQueueNumber(entry.queueNumber),
        status: entry.status,
      },
    });
  }

  private async enqueueCalledNotification(entry: {
    id: string;
    queueId: string;
    customerId: string;
    queueNumber: number;
  }): Promise<void> {
    await this.notificationQueue?.enqueueBestEffort(
      NotificationJobFactory.queueCalled(
        entry.customerId,
        entry.queueId,
        entry.id,
        formatQueueNumber(entry.queueNumber),
      ),
    );
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
