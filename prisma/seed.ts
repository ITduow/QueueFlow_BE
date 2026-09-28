import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to run the seed');
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

function timeAt(hour: number, minute = 0): Date {
  return new Date(Date.UTC(1970, 0, 1, hour, minute));
}

async function upsertService(
  businessId: string,
  name: string,
  description: string,
  durationMinutes: number,
  price: string,
): Promise<void> {
  const existing = await prisma.service.findFirst({ where: { businessId, name } });
  if (existing) {
    await prisma.service.update({
      where: { id: existing.id },
      data: { description, durationMinutes, price, isActive: true },
    });
    return;
  }

  await prisma.service.create({
    data: { businessId, name, description, durationMinutes, price },
  });
}

async function main(): Promise<void> {
  const demoPasswordHash = await argon2.hash('Demo1234A');
  const admin = await prisma.user.upsert({
    where: { email: 'admin@queueflow.local' },
    update: {
      fullName: 'QueueFlow Admin',
      role: UserRole.ADMIN,
      isActive: true,
      passwordHash: demoPasswordHash,
    },
    create: {
      email: 'admin@queueflow.local',
      fullName: 'QueueFlow Admin',
      role: UserRole.ADMIN,
      passwordHash: demoPasswordHash,
    },
  });
  const manager = await prisma.user.upsert({
    where: { email: 'manager@queueflow.local' },
    update: {
      fullName: 'Demo Manager',
      role: UserRole.MANAGER,
      isActive: true,
      passwordHash: demoPasswordHash,
    },
    create: {
      email: 'manager@queueflow.local',
      fullName: 'Demo Manager',
      role: UserRole.MANAGER,
      passwordHash: demoPasswordHash,
    },
  });
  await prisma.user.upsert({
    where: { email: 'customer@queueflow.local' },
    update: {
      fullName: 'Demo Customer',
      role: UserRole.CUSTOMER,
      isActive: true,
      passwordHash: demoPasswordHash,
    },
    create: {
      email: 'customer@queueflow.local',
      fullName: 'Demo Customer',
      role: UserRole.CUSTOMER,
      passwordHash: demoPasswordHash,
    },
  });

  const business = await prisma.business.upsert({
    where: { slug: 'queueflow-demo-clinic' },
    update: {
      ownerId: admin.id,
      name: 'QueueFlow Demo Clinic',
      status: 'ACTIVE',
      timezone: 'Asia/Ho_Chi_Minh',
    },
    create: {
      ownerId: admin.id,
      name: 'QueueFlow Demo Clinic',
      slug: 'queueflow-demo-clinic',
      description: 'Development business for QueueFlow demonstrations.',
      city: 'Ho Chi Minh City',
      status: 'ACTIVE',
      timezone: 'Asia/Ho_Chi_Minh',
    },
  });

  await prisma.businessMember.upsert({
    where: { uq_business_member: { businessId: business.id, userId: manager.id } },
    update: { role: UserRole.MANAGER, isActive: true },
    create: { businessId: business.id, userId: manager.id, role: UserRole.MANAGER },
  });

  await upsertService(
    business.id,
    'General Consultation',
    'Standard consultation session.',
    30,
    '100000',
  );
  await upsertService(
    business.id,
    'Extended Consultation',
    'Extended consultation session.',
    60,
    '180000',
  );
  await upsertService(business.id, 'Follow-up Visit', 'Short follow-up visit.', 20, '70000');

  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek += 1) {
    const isClosed = dayOfWeek === 0;
    await prisma.businessOpeningHour.upsert({
      where: { uq_business_day: { businessId: business.id, dayOfWeek } },
      update: {
        isClosed,
        openTime: isClosed ? null : timeAt(9),
        closeTime: isClosed ? null : timeAt(18),
      },
      create: {
        businessId: business.id,
        dayOfWeek,
        isClosed,
        openTime: isClosed ? null : timeAt(9),
        closeTime: isClosed ? null : timeAt(18),
      },
    });
  }

  console.log(
    `Seeded business ${business.slug} with admin ${admin.email} and manager ${manager.email}.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
