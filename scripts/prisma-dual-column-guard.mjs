#!/usr/bin/env node
/**
 * Refuse BigInt prisma db migrate against dual-column hosts.
 *
 * Live money cutover made promotions.value nullable (SQL 11 XOR with
 * value_amount). Canonical contract.prisma still has `value Int` (NOT NULL).
 * prisma db migrate / verify with the default config therefore fail:
 *   MIGRATION.SCHEMA_VERIFY_FAILED
 *   database.public.promotions.column:value expected nullable false, actual true
 *
 * DZD schema (contract.dzd.prisma / MONEY_PRISMA_DECIMAL=1 JSON) already has
 * `value Int?`. That is a different contract than the BigInt emit storageHash.
 * Do not migrate speedygo_dev / FX / rehearsal from this wrapper.
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function resolvePsql() {
  if (process.env.SPEEDYGO_PSQL) return process.env.SPEEDYGO_PSQL;
  const which = spawnSync('which', ['psql'], { encoding: 'utf8' });
  if (which.status === 0) {
    const found = which.stdout.trim();
    if (found) return found;
  }
  return '/opt/homebrew/opt/postgresql@17/bin/psql';
}

const PSQL = resolvePsql();

export const SHARED_MIGRATE_REFUSED = new Set([
  'speedygo_dev',
  'speedygo_parity_fx',
  'speedygo_money_migrate_rehearsal',
  'postgres',
]);

export function parseDatabaseName(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname.replace(/^\//, '')).split('?')[0];
  } catch {
    return null;
  }
}

export function psqlConnectionUrl(url) {
  const parsed = new URL(url);
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

export function isDzdConfig(argv) {
  const idx = argv.indexOf('--config');
  if (idx >= 0 && argv[idx + 1]) {
    return argv[idx + 1].includes('prisma.config.dzd');
  }
  return argv.some(
    (arg) => arg.startsWith('--config=') && arg.includes('prisma.config.dzd'),
  );
}

export function resolveMigrateUrl(argv, env = process.env) {
  const dbFlag = argv.indexOf('--db');
  if (dbFlag >= 0 && argv[dbFlag + 1]) return argv[dbFlag + 1];
  const eq = argv.find((arg) => arg.startsWith('--db='));
  if (eq) return eq.slice('--db='.length);
  return env.DATABASE_URL ?? null;
}

export function refuseReason({
  command,
  database,
  dualColumn,
  dzdConfig,
  allow = false,
}) {
  if (command !== 'migrate' && command !== 'plan') return null;
  if (database && SHARED_MIGRATE_REFUSED.has(database)) {
    return (
      `Refused prisma db migrate against ${database}. Dual-column money hosts ` +
      `are not advanced with the BigInt contract. Do not apply leftover ` +
      `migrations/app/20261022T2239_session_auth_audience (refunds CHECK rename).`
    );
  }
  if (dualColumn && !dzdConfig) {
    return (
      'Refused default (BigInt) prisma db migrate against a dual-column database. ' +
      'promotions.value is nullable (SQL 11 XOR / value_amount); contract.prisma ' +
      'expects value Int NOT NULL. Result: MIGRATION.SCHEMA_VERIFY_FAILED ' +
      'database.public.promotions.column:value expected nullable=false actual=true. ' +
      'Schema-only inspect: prisma db verify --schema-only --config prisma.config.dzd.ts. ' +
      'Do not force-migrate, fake the marker, or overwrite storageHash.'
    );
  }
  if (dualColumn && dzdConfig && !allow) {
    return (
      'Refused prisma db migrate --config prisma.config.dzd.ts without ' +
      'SPEEDYGO_PRISMA_MIGRATE_ALLOW=1. DZD schema-only verify still sees ' +
      'refunds_request_origin_check drift and MARKER_MISMATCH (marker is the last ' +
      'signed contract; DZD JSON storageHash is the copied BigInt emit hash, not ' +
      'a DZD content hash). Needs a reviewed apply/rollback plan.'
    );
  }
  return null;
}

function columnExists(url, table, column) {
  if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(column)) {
    throw new Error('refused: table/column are not identifiers');
  }
  const result = spawnSync(
    PSQL,
    [
      psqlConnectionUrl(url),
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
      '-c',
      `SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}' AND column_name = '${column}'`,
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'psql failed');
  }
  return result.stdout.trim() !== '0';
}

/** pnpm `script -- --db URL` forwards a literal `--`; Prisma 8 migrate takes 0 extra args. */
export function stripPassthrough(argv) {
  return argv.filter((arg) => arg !== '--');
}

function prismaArgs(command, argv) {
  const rest = stripPassthrough(argv);
  if (command === 'migrate') return ['db', 'migrate', ...rest];
  if (command === 'plan') return ['migration', 'plan', ...rest];
  if (command === 'verify') return ['db', 'verify', ...rest];
  throw new Error(`unknown command ${command}`);
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const command = argv[0];
  const rest = stripPassthrough(argv.slice(1));
  if (!command || command === '-h' || command === '--help') {
    console.error(
      'usage: prisma-dual-column-guard.mjs <migrate|plan|verify> [...prisma args]',
    );
    process.exit(2);
  }
  const url = resolveMigrateUrl(rest, env);
  const database = parseDatabaseName(url);
  const dzdConfig = isDzdConfig(rest);
  if (database && SHARED_MIGRATE_REFUSED.has(database) && (command === 'migrate' || command === 'plan')) {
    const reason = refuseReason({
      command,
      database,
      dualColumn: true,
      dzdConfig,
      allow: env.SPEEDYGO_PRISMA_MIGRATE_ALLOW === '1',
    });
    console.error(reason);
    process.exit(1);
  }
  let dualColumn = false;
  if (url && (command === 'migrate' || command === 'plan')) {
    try {
      dualColumn = columnExists(url, 'promotions', 'value_amount');
    } catch (err) {
      console.error(
        `dual-column probe failed: ${err instanceof Error ? err.message : err}`,
      );
      process.exit(2);
    }
  }
  const reason = refuseReason({
    command,
    database,
    dualColumn,
    dzdConfig,
    allow: env.SPEEDYGO_PRISMA_MIGRATE_ALLOW === '1',
  });
  if (reason) {
    console.error(reason);
    process.exit(1);
  }
  const result = spawnSync(
    'pnpm',
    ['exec', 'prisma', ...prismaArgs(command, rest)],
    { stdio: 'inherit', env },
  );
  process.exit(result.status === null ? 1 : result.status);
}

const invoked = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invoked) {
  await main();
}
