# Prisma 8 in this NestJS backend

This app uses Prisma 8 (`@prisma/orm-postgres` + `@prisma/orm-extension-postgis`).

Canonical schema: `prisma/contract.prisma` (SpeedyGo Prisma Schema v1.0).

```bash
pnpm contract:emit
pnpm prisma:migrate
pnpm prisma:verify
```

Open the client with `getDb()` in `prisma/db.ts`. Do not add Nest repositories yet.

See `prisma/README.md` and `docs/database/PRISMA_IMPLEMENTATION.md`.
