import { INestApplication } from '@nestjs/common';
import { UserRole, AppointmentStatus, QueueEntryStatus, NotificationType } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { io, Socket } from 'socket.io-client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RedisService } from '../../src/redis/redis.service';
import { RedisCacheService } from '../../src/redis/redis-cache.service';
import { NotificationQueue } from '../../src/jobs/notification/notification.queue';
import { createE2eApp } from './helpers/app.helper';
import { cleanDatabase, clearRedis } from './helpers/db.helper';
import {
  api,
  accessSession,
  bearer,
  login,
  nextWeekdayUtc,
  uniqueEmail,
  AuthSession,
} from './helpers/api.helper';

describe('QueueFlow real integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let admin: AuthSession;
  let customer: AuthSession;
  let secondCustomer: AuthSession;
  let businessId: string;
  let serviceId: string;
  let queueId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    await cleanDatabase(prisma);
    await clearRedis(redis);
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await clearRedis(redis);
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    await clearRedis(redis);
    const adminEmail = uniqueEmail('admin');
    const customerEmail = uniqueEmail('customer');
    const secondCustomerEmail = uniqueEmail('customer-two');
    const passwordHash = await argon2.hash('Strong1234A');
    await prisma.user.createMany({
      data: [
        { email: adminEmail, fullName: 'E2E Admin', passwordHash },
        { email: customerEmail, fullName: 'E2E Customer', passwordHash },
        { email: secondCustomerEmail, fullName: 'E2E Customer Two', passwordHash },
      ],
    });
    const adminUser = await prisma.user.update({
      where: { email: adminEmail },
      data: { role: UserRole.ADMIN },
    });
    admin = await accessSession(app, {
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
    });
    const customerUser = await prisma.user.findUniqueOrThrow({ where: { email: customerEmail } });
    const secondCustomerUser = await prisma.user.findUniqueOrThrow({
      where: { email: secondCustomerEmail },
    });
    customer = await accessSession(app, {
      id: customerUser.id,
      email: customerUser.email,
      role: customerUser.role,
    });
    secondCustomer = await accessSession(app, {
      id: secondCustomerUser.id,
      email: secondCustomerUser.email,
      role: secondCustomerUser.role,
    });

    const businessResponse = await api(app)
      .post('/api/businesses')
      .set(bearer(admin))
      .send({ name: `E2E Clinic ${Date.now()}`, timezone: 'UTC' });
    expect(businessResponse.status).toBe(201);
    businessId = businessResponse.body.data.id;
    const activateResponse = await api(app)
      .patch(`/api/businesses/${businessId}`)
      .set(bearer(admin))
      .send({ status: 'ACTIVE' });
    expect(activateResponse.status).toBe(200);

    const serviceResponse = await api(app)
      .post(`/api/businesses/${businessId}/services`)
      .set(bearer(admin))
      .send({ name: 'E2E Consultation', durationMinutes: 30, price: '100000' });
    expect(serviceResponse.status).toBe(201);
    serviceId = serviceResponse.body.data.id;

    const hours = Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      openTime: '00:00',
      closeTime: '23:59',
      isClosed: false,
    }));
    const hoursResponse = await api(app)
      .put(`/api/businesses/${businessId}/opening-hours`)
      .set(bearer(admin))
      .send({ hours });
    expect(hoursResponse.status).toBe(200);

    const queueResponse = await api(app)
      .post(`/api/businesses/${businessId}/queues`)
      .set(bearer(admin))
      .send({ name: `E2E Queue ${Date.now()}` });
    expect(queueResponse.status).toBe(201);
    queueId = queueResponse.body.data.id;
    void adminUser;
  });

  it('runs auth, refresh rotation, protected profile, and IDOR checks', async () => {
    const httpCustomer = await login(app, customer.user.email);
    const duplicate = await api(app)
      .post('/api/auth/register')
      .send({ email: customer.user.email, password: 'Strong1234A', fullName: 'Duplicate' });
    expect(duplicate.status).toBe(409);

    const me = await api(app).get('/api/auth/me').set(bearer(customer));
    expect(me.status).toBe(200);
    expect(me.body.data.passwordHash).toBeUndefined();

    const refresh = await api(app)
      .post('/api/auth/refresh')
      .set('Cookie', httpCustomer.refreshCookie);
    expect(refresh.status).toBe(200);
    expect(refresh.body.data.accessToken).toEqual(expect.any(String));

    const oldRefresh = await api(app)
      .post('/api/auth/refresh')
      .set('Cookie', httpCustomer.refreshCookie);
    expect(oldRefresh.status).toBe(401);

    const noToken = await api(app).get('/api/users/me');
    expect(noToken.status).toBe(401);

    const otherBusiness = await api(app)
      .post('/api/businesses')
      .set(bearer(customer))
      .send({ name: `Other ${Date.now()}`, timezone: 'UTC' });
    expect(otherBusiness.status).toBe(201);
    const crossScope = await api(app)
      .patch(`/api/businesses/${otherBusiness.body.data.id}`)
      .set(bearer(secondCustomer))
      .send({ name: 'Denied update' });
    expect(crossScope.status).toBe(403);
  });

  it('persists services, opening hours, appointments, queues, and notifications', async () => {
    const publicServices = await api(app).get(`/api/businesses/${businessId}/services`);
    expect(publicServices.status).toBe(200);
    expect(publicServices.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: serviceId })]),
    );

    const appointmentStart = nextWeekdayUtc(10);
    const appointment = await api(app).post('/api/appointments').set(bearer(customer)).send({
      businessId,
      serviceId,
      startTime: appointmentStart.toISOString(),
    });
    expect(appointment.status).toBe(201);
    const appointmentId = appointment.body.data.id;

    const confirmed = await api(app)
      .patch(`/api/appointments/${appointmentId}/confirm`)
      .set(bearer(admin));
    expect(confirmed.status).toBe(200);

    const notification = await waitForNotification(prisma, customer.user.id, 'BOOKING_CONFIRMED');
    expect(notification).toBeDefined();

    const joined = await api(app)
      .post(`/api/queues/${queueId}/join`)
      .set(bearer(customer))
      .send({ serviceId });
    expect(joined.status).toBe(201);
    expect(joined.body.data.queueNumber).toBe(1);

    const duplicateJoin = await api(app)
      .post(`/api/queues/${queueId}/join`)
      .set(bearer(customer))
      .send({ serviceId });
    expect(duplicateJoin.status).toBe(409);
    expect(duplicateJoin.body.code).toBe('QUEUE_ALREADY_JOINED');

    const next = await api(app).post(`/api/queues/${queueId}/next`).set(bearer(admin));
    expect(next.status).toBe(201);

    const queueNotification = await waitForNotification(prisma, customer.user.id, 'QUEUE_CALLED');
    expect(queueNotification).toBeDefined();
    const notifications = await api(app).get('/api/notifications').set(bearer(customer));
    expect(notifications.status).toBe(200);
    expect(notifications.body.data.data.length).toBeGreaterThanOrEqual(2);

    const appointmentRow = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    expect(appointmentRow?.status).toBe(AppointmentStatus.CONFIRMED);
  });

  it('allows one same-slot appointment and one queue number per concurrent join', async () => {
    const appointmentStart = nextWeekdayUtc(12);
    const appointmentResponses = await Promise.all([
      api(app)
        .post('/api/appointments')
        .set(bearer(customer))
        .send({ businessId, serviceId, startTime: appointmentStart.toISOString() }),
      api(app)
        .post('/api/appointments')
        .set(bearer(secondCustomer))
        .send({ businessId, serviceId, startTime: appointmentStart.toISOString() }),
    ]);
    const appointmentStatuses = appointmentResponses.map((response) => response.status);
    expect(appointmentStatuses).toHaveLength(2);
    expect(appointmentStatuses).toEqual(expect.arrayContaining([201, 409]));

    const joinResults = await Promise.all(
      Array.from({ length: 10 }, async (_, index) => {
        const email = uniqueEmail(`join-${index}`);
        await prisma.user.create({
          data: {
            email,
            fullName: `Join Customer ${index}`,
            passwordHash: await argon2.hash('Strong1234A'),
          },
        });
        const user = await prisma.user.findUniqueOrThrow({ where: { email } });
        const session = await accessSession(app, {
          id: user.id,
          email: user.email,
          role: user.role,
        });
        return api(app)
          .post(`/api/queues/${queueId}/join`)
          .set(bearer(session))
          .send({ serviceId });
      }),
    );
    expect(joinResults.every((result) => result.status === 201)).toBe(true);
    const entries = await prisma.queueEntry.findMany({
      where: { queueId },
      orderBy: { queueNumber: 'asc' },
    });
    expect(entries.map((entry) => entry.queueNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(entries.every((entry) => entry.status === QueueEntryStatus.WAITING)).toBe(true);
  });

  it('uses real Redis for health, cache, and idempotent notification jobs', async () => {
    expect(await redis.ping()).toBe(true);
    const cache = app.get(RedisCacheService);
    const key = `e2e:${randomUUID()}`;
    await cache.set(key, { value: 'cached' }, 30);
    expect(await cache.get<{ value: string }>(key)).toEqual({ value: 'cached' });
    await cache.delete(key);
    expect(await cache.get(key)).toBeNull();

    const eventId = randomUUID();
    const queue = app.get(NotificationQueue);
    const payload = {
      eventId,
      userId: customer.user.id,
      type: NotificationType.GENERAL,
      title: 'E2E notification',
      message: 'This event must be persisted once.',
    };
    await queue.enqueueBestEffort(payload);
    await queue.enqueueBestEffort(payload);
    const notification = await waitForNotificationByEvent(prisma, eventId);
    expect(notification).toBeDefined();
    expect(await prisma.notification.count({ where: { sourceEventId: eventId } })).toBe(1);
  });

  it('authenticates WebSocket clients, authorizes rooms, and receives queue events', async () => {
    const baseUrl = await app.getUrl();
    const customerSocket = await connectSocket(baseUrl, customer.accessToken);
    const deniedSocket = await connectSocket(baseUrl, secondCustomer.accessToken);
    const adminSocket = await connectSocket(baseUrl, admin.accessToken);
    try {
      const customerJoined = waitForAnySocketEvent(customerSocket);
      customerSocket.emit('business:join', { businessId });
      expect((await customerJoined).event).toBe('error');
      const adminJoined = waitForAnySocketEvent(adminSocket);
      adminSocket.emit('business:join', { businessId });
      expect((await adminJoined).event).toBe('business:joined');
      const denied = waitForSocketEvent<{ code: string }>(deniedSocket, 'error');
      deniedSocket.emit('business:join', { businessId });
      expect((await denied).code).toBe('REALTIME_ACCESS_DENIED');

      const joined = await api(app)
        .post(`/api/queues/${queueId}/join`)
        .set(bearer(customer))
        .send({ serviceId });
      expect(joined.status).toBe(201);
      const queueRoom = waitForSocketEvent<{ queueId: string }>(
        customerSocket,
        'queue:joined-room',
      );
      customerSocket.emit('queue:join-room', { queueId });
      expect((await queueRoom).queueId).toBe(queueId);
      const called = waitForSocketEvent<{ queueId: string }>(customerSocket, 'queue:called');
      const next = await api(app).post(`/api/queues/${queueId}/next`).set(bearer(admin));
      expect(next.status).toBe(201);
      expect((await called).queueId).toBe(queueId);
    } finally {
      customerSocket.close();
      deniedSocket.close();
      adminSocket.close();
    }
  });
});

async function waitForNotification(prisma: PrismaService, userId: string, type: string) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const notification = await prisma.notification.findFirst({
      where: { userId, type: type as never },
    });
    if (notification) return notification;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return undefined;
}

async function waitForNotificationByEvent(prisma: PrismaService, eventId: string) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const notification = await prisma.notification.findFirst({ where: { sourceEventId: eventId } });
    if (notification) return notification;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return undefined;
}

async function connectSocket(baseUrl: string, token: string): Promise<Socket> {
  const socket = io(`${baseUrl}/realtime`, { auth: { token }, transports: ['websocket'] });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
  return socket;
}

function waitForSocketEvent<T = unknown>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 10000);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload as T);
    });
  });
}

function waitForAnySocketEvent(socket: Socket): Promise<{ event: string; payload: unknown }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for any socket event')),
      10000,
    );
    const listener = (event: string, payload: unknown) => {
      clearTimeout(timer);
      socket.offAny(listener);
      resolve({ event, payload });
    };
    socket.onAny(listener);
  });
}
