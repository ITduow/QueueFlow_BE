import type { INestApplication } from '@nestjs/common';
import request, { Test } from 'supertest';
import { JwtService } from '@nestjs/jwt';

export interface AuthSession {
  accessToken: string;
  refreshCookie: string;
  user: { id: string; email: string; role: string };
}

interface ApiClient {
  get(path: string): Test;
  post(path: string): Test;
  patch(path: string): Test;
  put(path: string): Test;
  delete(path: string): Test;
}

export function api(app: INestApplication): ApiClient {
  const agent = request(app.getHttpServer());
  const versioned = (path: string) =>
    path.startsWith('/api/v1/') ? path : path.replace('/api/', '/api/v1/');
  return {
    get: (path: string) => agent.get(versioned(path)),
    post: (path: string) => agent.post(versioned(path)),
    patch: (path: string) => agent.patch(versioned(path)),
    put: (path: string) => agent.put(versioned(path)),
    delete: (path: string) => agent.delete(versioned(path)),
  };
}

export async function register(app: INestApplication, email: string, password = 'Strong1234A') {
  const response = await api(app)
    .post('/api/auth/register')
    .send({ email, password, fullName: email.split('@')[0] });
  expect(response.status).toBe(201);
  return response.body.data as { id: string; email: string };
}

export async function login(
  app: INestApplication,
  email: string,
  password = 'Strong1234A',
): Promise<AuthSession> {
  const response = await api(app).post('/api/auth/login').send({ email, password });
  expect(response.status).toBe(200);
  const cookies = response.headers['set-cookie'] as unknown as string[] | undefined;
  expect(cookies?.length).toBeGreaterThan(0);
  return {
    accessToken: response.body.data.accessToken as string,
    refreshCookie: cookies![0].split(';')[0],
    user: response.body.data.user,
  };
}

export function bearer(session: AuthSession): { Authorization: string } {
  return { Authorization: `Bearer ${session.accessToken}` };
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}@e2e.local`;
}

export async function accessSession(
  app: INestApplication,
  user: { id: string; email: string; role: string },
): Promise<AuthSession> {
  const accessToken = await app.get(JwtService).signAsync({
    sub: user.id,
    email: user.email,
    role: user.role,
  });
  return { accessToken, refreshCookie: '', user };
}

export function nextWeekdayUtc(hour = 10): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 2);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}
