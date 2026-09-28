import { PrismaService } from '../../../src/prisma/prisma.service';
import { RedisService } from '../../../src/redis/redis.service';

export async function cleanDatabase(prisma: PrismaService): Promise<void> {
  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.queueEntry.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.queue.deleteMany();
  await prisma.businessOpeningHour.deleteMany();
  await prisma.service.deleteMany();
  await prisma.businessMember.deleteMany();
  await prisma.business.deleteMany();
  await prisma.user.deleteMany();
}

export async function clearRedis(redis: RedisService): Promise<void> {
  const client = redis.getClient();
  if (redis.isAvailable() && client) await client.flushdb();
}
