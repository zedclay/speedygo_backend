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
| PostgreSQL | 5432 |
| Redis | 6379 |
| MinIO API | 9000 |
| MinIO console | 9001 |

Health: `GET /health` (also available under the global prefix as `GET /api/v1`).

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
