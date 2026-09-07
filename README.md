# SpeedyGo Backend

NestJS modular monolith for SpeedyGo.

GitHub: https://github.com/zedclay/speedygo_backend.git

This repository is the **source of truth** for pricing, commissions, merchant net, driver remuneration, COD, payments, refunds, order state transitions, and permissions.

Frontends must consume backend contracts. They must never independently calculate authoritative financial values.

## Stack

- NestJS + TypeScript
- Node.js 24 LTS
- PostgreSQL 16 + PostGIS + Prisma 8 contract (`prisma/contract.prisma`)
- Redis + BullMQ
- Socket.IO
- OpenAPI / Swagger
- Docker Compose for local dependencies

Architecture: **modular monolith**. Do not split into microservices unless explicitly approved.

## Local setup

```bash
cp .env.example .env
pnpm install
docker compose up -d
pnpm start:dev
```

| Service | Port |
| --- | --- |
| API | 3000 |
| OpenAPI UI | 3000 `/docs` |
| PostgreSQL | 5433 (host) → 5432 (container); override with `SPEEDYGO_POSTGRES_HOST_PORT` |
| Redis | 6381 (host) → 6379 (container); override with `SPEEDYGO_REDIS_HOST_PORT` |
| MinIO API | 9000 |
| MinIO console | 9001 |

Health: `GET /health` (also available under the global prefix as `GET /api/v1`).

Auth architecture: [AUTHENTICATION.md](../../docs/architecture/AUTHENTICATION.md).

CORS (P1-H): browser Origin allowlist via `CORS_ALLOWED_ORIGINS` (exact match; shared by HTTP and Socket.IO `/realtime`). See [CORS_CONFIGURATION_FOUNDATION.md](../../docs/architecture/CORS_CONFIGURATION_FOUNDATION.md). Local Admin Web (Vite) typically uses `http://localhost:5173` / `http://127.0.0.1:5173`. Native Flutter apps and provider webhooks do not send `Origin` and are not blocked by CORS. CORS is not authentication.

Local OTP: set `OTP_TRANSPORT=console` (development only). Production refuses that transport.

E2E uses isolated `speedygo_test` on SpeedyGo Postgres host port **5433**, and SpeedyGo Redis on host port **6381**, database **15** (`redis://127.0.0.1:6381/15`). E2E does not inherit shared `DATABASE_URL` on port 5432 or `REDIS_URL` on port 6379, and refuses unsafe targets. They never write to `speedygo_dev`. Apply the existing migration history to `speedygo_test` once (`prisma db migrate --db .../speedygo_test`). Jest is launched with `--experimental-vm-modules` because Prisma 8 runtime packages are ESM.

## Prisma

See `prisma/README.md`. Do not invent tables. Sequence:

**SpeedyGo Domain Model v1.0 → ERD v1.0 → Prisma Schema v1.0**

See `prisma/README.md` and `docs/database/PRISMA_IMPLEMENTATION.md`.

```bash
pnpm contract:emit
pnpm prisma:migrate
pnpm prisma:verify
```

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm start:dev` | Watch mode |
| `pnpm build` | Compile |
| `pnpm lint` | ESLint |
| `pnpm test` | Unit tests |
| `pnpm test:e2e` | E2E tests |
