# Prisma 8 — SpeedyGo Schema v1.0

Canonical contract (one schema only):

```
prisma/contract.prisma
```

Derived from [ERD v1.0](../../../docs/database/ERD.md). Implementation notes: [PRISMA_IMPLEMENTATION.md](../../../docs/database/PRISMA_IMPLEMENTATION.md).

There is **no** `schema.prisma` and **no** `@prisma/client`. Do not add a second schema.

## Layout

| Path | Role |
| --- | --- |
| `prisma.config.ts` | Prisma 8 CLI + PostGIS extension |
| `prisma/contract.prisma` | Authored models |
| `prisma/contract.json` / `contract.d.ts` | Emitted — `pnpm contract:emit` |
| `prisma/db.ts` | `getDb()` client |
| `migrations/app/20260901T0054_init_speedygo_v1` | Initial SpeedyGo DDL |
| `migrations/postgis/20260601T0000_install_postgis_extension` | `CREATE EXTENSION postgis` |

## Commands

```bash
cp .env.example .env
# First-time PostGIS image (source tarball is gitignored):
curl -L -o docker/postgres-postgis/postgis-3.5.7.tar.gz \
  https://github.com/postgis/postgis/archive/3.5.7.tar.gz
docker compose up -d --build postgres
pnpm contract:emit
pnpm prisma:migrate
pnpm prisma:verify
```

`DATABASE_URL` must be the local Compose database (`localhost:5432/speedygo_dev`). Do not migrate a remote database from this foundation.

## Rules baked into the contract

- UUID PKs, no UUIDv4 default — application generates UUIDv7 later
- Money: `BigInt` minor units. Rates: `Int` bps
- Status machines: text-backed enums (not PostgreSQL ENUM)
- Partial uniques: one default address, one ACTIVE cart, one open assignment, active plate, active device token
- CHECKs: money ≥ 0 (except documented signed columns), commission scope/merchant_id, rating 1..5
- Snapshot FKs: RESTRICT (never cascade-delete financial history)
- `DriverLiveLocation` is not a table

## Future backend notes

- Do not `JSON.stringify` `bigint` money in HTTP responses
- Do not expose arbitrary `OrderFinancialSnapshot` updates
- Do not invent commercial formulas still listed as REQUIRES BUSINESS CONFIRMATION
