# QueueFlow Backend

NestJS modular monolith backend for QueueFlow. This repository is being delivered incrementally according to the project roadmap.

## Setup

Requirements: Node.js LTS (20+), npm 10+, and PostgreSQL/Redis for later phases.

```powershell
Copy-Item .env.example .env
npm install
npm run start:dev
```

The application listens on `http://localhost:3000`, exposes `GET /api/v1/health`, and exposes Swagger at `GET /api/docs` when `SWAGGER_ENABLED=true`.

Environment variables are validated during startup. Secrets must be supplied through the environment and must not be committed.

## Commands

```powershell
npm run build
npm test
npm run lint
npm run format:check
```

Database schema, Prisma, authentication, business modules, queues, realtime, jobs, tests, Docker and deployment files are intentionally introduced in their corresponding roadmap phases.

## Phase 2 database

Prisma migrations are the source of truth. The reference SQL file is not executed by the application. Copy `.env.example` to `.env` and replace `DATABASE_URL` with valid PostgreSQL credentials for the `QueueFlow` database.

```powershell
npm run prisma:format
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate:deploy
npm run seed
```

The initial migration contains PostgreSQL-only CHECK constraints, partial unique indexes for active bookings and queue entries, and `updated_at` triggers. Seed demo users receive an Argon2 password hash for local authentication tests.

## Authentication

Phase 3 provides register, login, refresh-token rotation, logout, logout-all, `/api/v1/auth/me`, JWT authentication and global role guards. Access tokens use the `Authorization: Bearer <token>` header. Refresh tokens are stored only as Argon2 hashes and sent through the `queueflow_refresh_token` HttpOnly cookie.

Development seed accounts use password `Demo1234A`:

- `admin@queueflow.local`
- `manager@queueflow.local`
- `customer@queueflow.local`

These credentials are for local development only and must not be used in production.

## User management

Phase 4 provides:

- `GET /api/v1/users/me`
- `PATCH /api/v1/users/me`
- `PATCH /api/v1/users/me/password`
- `GET /api/v1/admin/users`
- `GET /api/v1/admin/users/:id`
- `PATCH /api/v1/admin/users/:id/status`

Profile updates use an allowlist. Password changes atomically update the password and revoke active refresh sessions; existing short-lived access tokens can remain valid until expiry. Admin status changes revoke sessions for disabled users and protect against self-disable and disabling the last active admin. Role changes, email changes, deletion, and business-scoped permissions remain deferred.

## Business management

Phase 5 provides business creation, public active-business listing/detail, owner/manager updates, suspension, and member management:

- `POST /api/v1/businesses`
- `GET /api/v1/businesses`
- `GET /api/v1/businesses/:slug`
- `PATCH /api/v1/businesses/:id`
- `DELETE /api/v1/businesses/:id` (suspends the business)
- `GET/POST /api/v1/businesses/:id/members`
- `PATCH/DELETE /api/v1/businesses/:id/members/:memberId`

Business operations verify ownership or membership on the specific business, preventing IDOR across businesses. Public endpoints expose only `ACTIVE` businesses. Business-scoped authorization is separate from global user roles; manager/staff membership is enforced by the database constraint and service checks.

## Services, opening hours and availability

Phase 6 provides business-scoped service management, public service discovery, opening-hour replacement, and timezone-aware availability foundations:

- `POST /api/v1/businesses/:businessId/services`
- `GET /api/v1/businesses/:businessId/services`
- `GET /api/v1/services/:id`
- `PATCH /api/v1/services/:id`
- `DELETE /api/v1/services/:id` (soft-deactivates the service)
- `GET /api/v1/businesses/:businessId/opening-hours`
- `PUT /api/v1/businesses/:businessId/opening-hours`

Public service endpoints expose only active services belonging to active businesses. Service creation and updates require an owner, manager, or admin; staff members are denied. Service prices are accepted as decimal strings and persisted with Prisma `Decimal`, avoiding JavaScript floating-point money calculations.

Opening hours are validated as one row per weekday, with `HH:mm` API values mapped to PostgreSQL `TIME`. Replacement is performed atomically. Availability helpers use the business IANA timezone through `Intl.DateTimeFormat` rather than the server timezone, and include business-local weekday/time conversion and service end-time calculation.

## Appointments

Phase 7 provides appointment creation, customer and business lists, appointment detail access, cancellation, operational status transitions, and public service availability:

- `POST /api/v1/appointments`
- `GET /api/v1/appointments/me`
- `GET /api/v1/appointments/:id`
- `PATCH /api/v1/appointments/:id/cancel`
- `GET /api/v1/businesses/:businessId/appointments`
- `PATCH /api/v1/appointments/:id/confirm`
- `PATCH /api/v1/appointments/:id/complete`
- `PATCH /api/v1/appointments/:id/no-show`
- `GET /api/v1/businesses/:businessId/services/:serviceId/availability?date=YYYY-MM-DD`

New appointments start as `PENDING`. Valid transitions are `PENDING → CONFIRMED`, `PENDING → CANCELLED`, `CONFIRMED → COMPLETED`, `CONFIRMED → NO_SHOW`, and `CONFIRMED → CANCELLED`. Transitions use conditional database updates so concurrent operational requests cannot both win.

Appointment times are stored as UTC instants. Opening-hours validation and availability dates use the business IANA timezone. Availability generates advisory 15-minute slots and does not reserve a slot; final booking success is decided by validation followed by PostgreSQL constraints during `POST /appointments`.

Active service appointments use `[start, end)` interval semantics. Application pre-checks reject service overlap and customer overlap for `PENDING`/`CONFIRMED` appointments, while the migration `20260927010000_add_appointment_overlap_constraints` adds PostgreSQL GiST exclusion constraints as the final concurrency protection. Prisma models the application schema; PostgreSQL migrations enforce the advanced range integrity. The existing exact `service_id + start_time` partial unique index is retained for compatibility and is partially redundant with the range constraint.

The MVP assumes one appointment capacity per service and prevents a customer from overlapping appointments across businesses. Availability is advisory and a concurrent booking can still return `409` when the database constraint wins the race.

## Queue architecture

Phase 8 adds queue creation, customer join/leave/status, staff queue operations, wait-time estimates, and queue-entry state transitions:

- `POST /api/v1/businesses/:businessId/queues`
- `GET /api/v1/businesses/:businessId/queues/current`
- `POST /api/v1/queues/:queueId/join`
- `DELETE /api/v1/queues/:queueId/leave`
- `GET /api/v1/queues/:queueId/status`
- `GET /api/v1/queues/:queueId/entries`
- `POST /api/v1/queues/:queueId/next`
- `PATCH /api/v1/queue-entries/:entryId/call`
- `PATCH /api/v1/queue-entries/:entryId/serve`
- `PATCH /api/v1/queue-entries/:entryId/complete`
- `PATCH /api/v1/queue-entries/:entryId/skip`

Queue dates are calculated in the business IANA timezone. Queue numbers are stored as integers and formatted at the API boundary (`1 → A001`, `1000 → A1000`). PostgreSQL remains the source of truth; Redis, WebSocket and BullMQ are intentionally deferred.

Concurrency uses three database-backed strategies:

- Join numbering: atomic `lastQueueNumber` increment and `QueueEntry` creation in one transaction, with rollback if creation fails.
- Next customer: parameterized `SELECT ... FOR UPDATE SKIP LOCKED` inside a transaction, selecting the lowest waiting queue number without handing the same entry to two staff requests.
- Entry transitions: conditional `UPDATE ... WHERE status = expected`, mapping a lost race to `409 QUEUE_INVALID_STATE`.

Active customer queue entries are protected by the existing partial unique index. Queue wait time is a dynamic approximation based on service durations for active entries ahead; it does not model parallel counters, staff capacity, historical service duration, or paused queues. Customer status responses expose counts and formatted queue numbers only, not other customers' personal data.

## Redis and realtime

Phase 9 adds optional Redis cache infrastructure and Socket.IO realtime under the `/realtime` namespace. Configure `REDIS_URL` when Redis is available; without it, the core REST API continues with PostgreSQL as the source of truth and cache/realtime run in degraded mode.

Public business detail, active service lists, and opening hours use cache-aside keys with a default 300-second TTL. Database mutations commit first and invalidate related keys afterward. Cache failures are fail-open: the request falls back to PostgreSQL and stale cache is allowed to expire if invalidation fails. Appointment and queue state are not cached, and permissions are always resolved from PostgreSQL.

Socket clients authenticate with an access token in the handshake:

```javascript
io('/realtime', { auth: { token: accessToken } });
```

Authenticated clients automatically join their user room. Domain-aware `business:join` and `queue:join-room` events validate ownership, active membership, admin access, or an active customer queue entry; arbitrary room names are never accepted. Queue mutations emit sanitized events such as `queue:joined`, `queue:called`, `queue:serving`, `queue:completed`, `queue:skipped`, and `queue:cancelled`, plus queue updates. Events are emitted only after the PostgreSQL mutation succeeds, and failed realtime delivery never rolls back the mutation.

When Redis is connected, Socket.IO uses the Redis adapter for cross-instance delivery. Without Redis, realtime is single-instance only. This matters for Cloud Run: multiple backend instances require the Redis adapter for clients connected to one instance to receive events emitted by another. WebSocket authentication is performed at connection time; token expiry or user disablement does not forcibly disconnect an already-open socket until reconnect.

Conceptual flow:

```text
Client ── REST ──> NestJS ──> PostgreSQL
   │                 │
   └ Socket.IO ──> Realtime Gateway ──> Redis adapter (optional)
                         │
                         └ Redis cache (optional)
```

## Notifications and background jobs

Phase 10 adds PostgreSQL-backed notifications and a BullMQ worker using Redis only as the job transport:

- `GET /api/v1/notifications`
- `GET /api/v1/notifications/unread-count`
- `PATCH /api/v1/notifications/:id/read`
- `PATCH /api/v1/notifications/read-all`

Queue and appointment mutations enqueue minimal notification payloads after the main database operation succeeds. The worker persists the notification before emitting `notification:new` to the user's realtime room. The existing immediate queue events and persistent notifications serve different purposes: queue events update live state, while notifications power the user's notification history/bell.

Jobs use the `notifications` queue with configurable attempts and exponential backoff (`NOTIFICATION_JOB_ATTEMPTS`, `NOTIFICATION_JOB_BACKOFF_MS`). Completed and failed BullMQ jobs have bounded age/count cleanup. Worker execution is at-least-once; `Notification.sourceEventId` is a unique idempotency key and prevents duplicate notification rows when a job retries. Duplicate events are treated as successful without re-emitting realtime.

The current deployment can run API and worker in one process. A future deployment can split them into separate Cloud Run API and worker services sharing Redis and PostgreSQL. There is intentionally no transactional outbox in this phase: a PostgreSQL commit followed by a process crash before enqueue can lose a notification. Core queue/appointment state remains durable in PostgreSQL and is never rolled back because enqueue or realtime delivery fails.

```text
Queue/Appointment mutation
          |
          v
   PostgreSQL commit
          |
          v
   BullMQ notification job
          |
          v
       Worker
          |
          v
  Notification table
          |
          v
  notification:new
```

## Stabilization and local deployment

Phase 11 adds readiness checks, request throttling on authentication endpoints, a non-root production image, Docker Compose infrastructure, and a CI workflow.

Health endpoints are:

- `GET /health/live` for process liveness
- `GET /health/ready` for PostgreSQL readiness plus Redis status
- `GET /health` as the compatibility health endpoint

For an isolated local stack, Docker Compose uses PostgreSQL credentials declared only inside the compose file and publishes PostgreSQL on host port `55432` to avoid colliding with a local PostgreSQL service:

```powershell
docker compose up -d postgres redis
docker compose run --rm migrate
docker compose run --rm seed
docker compose up --build api
```

The compose credentials and JWT values are development-only. Replace them before using the stack outside local development. For a host-based setup, copy `.env.example` to `.env` only after replacing every placeholder with real credentials. Never commit `.env`.

The GitHub Actions workflow in `.github/workflows/ci.yml` starts PostgreSQL and Redis services, deploys migrations against the test database, and runs Prisma validation/generation, lint, formatting, unit tests, and the production build. Real external integration and E2E execution still require valid environment credentials and infrastructure.
