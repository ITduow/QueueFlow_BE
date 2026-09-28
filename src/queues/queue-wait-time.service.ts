import { Injectable } from '@nestjs/common';
import { QueueEntryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const activeEntryStatuses = [
  QueueEntryStatus.WAITING,
  QueueEntryStatus.CALLED,
  QueueEntryStatus.SERVING,
];

@Injectable()
export class QueueWaitTimeService {
  constructor(private readonly prisma: PrismaService) {}

  async calculateForEntry(queueId: string, queueNumber: number) {
    const ahead = await this.prisma.queueEntry.findMany({
      where: { queueId, queueNumber: { lt: queueNumber }, status: { in: activeEntryStatuses } },
      select: { service: { select: { durationMinutes: true } } },
    });
    return ahead.reduce((total, entry) => total + entry.service.durationMinutes, 0);
  }

  async currentServing(queueId: string) {
    const serving = await this.prisma.queueEntry.findFirst({
      where: { queueId, status: QueueEntryStatus.SERVING },
      select: { queueNumber: true },
      orderBy: { queueNumber: 'asc' },
    });
    return serving?.queueNumber ?? null;
  }
}
