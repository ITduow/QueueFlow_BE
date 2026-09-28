import { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { io, Socket } from 'socket.io-client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RedisService } from '../../src/redis/redis.service';
import { SocketIoRedisAdapterService } from '../../src/realtime/socket-io-redis-adapter.service';
import { NotificationProcessor } from '../../src/jobs/notification/notification.processor';
import { createE2eApp } from './helpers/app.helper';
import { api, accessSession, bearer, uniqueEmail, AuthSession } from './helpers/api.helper';
import { cleanDatabase, clearRedis } from './helpers/db.helper';

describe('QueueFlow cross-instance realtime', () => {
  let appA: INestApplication;
  let appB: INestApplication;
  let prisma: PrismaService;
  let admin: AuthSession;
  let customer: AuthSession;
  let queueId: string;
  let serviceId: string;
  let businessId: string;

  beforeAll(async () => {
    appA = await createE2eApp();
    appB = await createE2eApp();
    prisma = appA.get(PrismaService);
    await cleanDatabase(prisma);
    await clearRedis(appA.get(RedisService));

    const passwordHash = await argon2.hash('Strong1234A');
    const adminEmail = uniqueEmail('cross-admin');
    const customerEmail = uniqueEmail('cross-customer');
    await prisma.user.createMany({
      data: [
        { email: adminEmail, fullName: 'Cross Admin', passwordHash, role: UserRole.ADMIN },
        { email: customerEmail, fullName: 'Cross Customer', passwordHash },
      ],
    });
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
    const customerUser = await prisma.user.findUniqueOrThrow({ where: { email: customerEmail } });
    admin = await accessSession(appA, {
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
    });
    customer = await accessSession(appA, {
      id: customerUser.id,
      email: customerUser.email,
      role: customerUser.role,
    });

    const business = await api(appA)
      .post('/api/businesses')
      .set(bearer(admin))
      .send({ name: `Cross Clinic ${Date.now()}`, timezone: 'UTC' });
    expect(business.status).toBe(201);
    businessId = business.body.data.id as string;
    expect(
      (
        await api(appA)
          .patch(`/api/businesses/${businessId}`)
          .set(bearer(admin))
          .send({ status: 'ACTIVE' })
      ).status,
    ).toBe(200);
    const service = await api(appA)
      .post(`/api/businesses/${businessId}/services`)
      .set(bearer(admin))
      .send({ name: 'Cross Consultation', durationMinutes: 30, price: '100000' });
    expect(service.status).toBe(201);
    serviceId = service.body.data.id;
    const hours = Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      openTime: '00:00',
      closeTime: '23:59',
      isClosed: false,
    }));
    expect(
      (
        await api(appA)
          .put(`/api/businesses/${businessId}/opening-hours`)
          .set(bearer(admin))
          .send({ hours })
      ).status,
    ).toBe(200);
    const queue = await api(appA)
      .post(`/api/businesses/${businessId}/queues`)
      .set(bearer(admin))
      .send({ name: `Cross Queue ${Date.now()}` });
    expect(queue.status).toBe(201);
    queueId = queue.body.data.id;
    await waitForAdapter(appA);
    await waitForAdapter(appB);
  });

  afterAll(async () => {
    await appA.close();
    await appB.close();
  });

  it('delivers a queue event from instance B to a client connected to instance A', async () => {
    const joined = await api(appA)
      .post(`/api/queues/${queueId}/join`)
      .set(bearer(customer))
      .send({ serviceId });
    expect(joined.status).toBe(201);
    const socket = await connectSocket(await appA.getUrl(), customer.accessToken);
    try {
      const roomJoined = waitForSocketEvent<{ queueId: string }>(socket, 'queue:joined-room');
      socket.emit('queue:join-room', { queueId });
      expect((await roomJoined).queueId).toBe(queueId);
      const called = waitForSocketEvent<{ queueId: string }>(socket, 'queue:called');
      const next = await api(appB).post(`/api/queues/${queueId}/next`).set(bearer(admin));
      expect(next.status).toBe(201);
      expect((await called).queueId).toBe(queueId);
    } finally {
      socket.close();
    }
  });

  it('delivers a notification produced and processed by instance B to instance A', async () => {
    await appA.get(NotificationProcessor).onModuleDestroy();
    const startTime = new Date(Date.now() + 48 * 60 * 60 * 1000);
    startTime.setUTCMinutes(0, 0, 0);
    const appointment = await api(appA)
      .post('/api/appointments')
      .set(bearer(customer))
      .send({ businessId, serviceId, startTime: startTime.toISOString() });
    expect(appointment.status).toBe(201);
    const socket = await connectSocket(await appA.getUrl(), customer.accessToken);
    try {
      const notification = waitForSocketEvent<{ type: string }>(socket, 'notification:new');
      const confirmed = await api(appB)
        .patch(`/api/appointments/${appointment.body.data.id}/confirm`)
        .set(bearer(admin));
      expect(confirmed.status).toBe(200);
      expect((await notification).type).toBe('BOOKING_CONFIRMED');
    } finally {
      socket.close();
    }
  });
});

async function waitForAdapter(app: INestApplication): Promise<void> {
  const adapter = app.get(SocketIoRedisAdapterService);
  const deadline = Date.now() + 5000;
  while (!adapter.isReady() && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 50));
  expect(adapter.isReady()).toBe(true);
}

async function connectSocket(url: string, token: string): Promise<Socket> {
  const socket = io(`${url}/realtime`, { auth: { token }, transports: ['websocket'] });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

function waitForSocketEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 10000);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}
