import 'dotenv/config';
import { definePrismaConfig } from 'prisma/config';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';
import postgis from '@prisma/orm-extension-postgis/control';

/**
 * Isolated DZD target emit. Uses contract.dzd.prisma.
 * Always pass `--output-path` for emit so this never overwrites prisma/contract.json.
 * Schema-only verify is safe on a dual-column clone. Do not `prisma db migrate`
 * speedygo_dev / FX / rehearsal with this config without a reviewed plan.
 * Shared runtime stays on prisma.config.ts + contract.dzd.json (MONEY_PRISMA_DECIMAL=1).
 */
export default definePrismaConfig({
  orm: ormConfig({
    contract: './prisma/contract.dzd.prisma',
    db: {
      connection: process.env['DATABASE_URL']!,
    },
    extensions: [postgis],
  }),
});
