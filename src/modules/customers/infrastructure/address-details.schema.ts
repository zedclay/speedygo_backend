import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { assertSafeE2eDatabaseUrl } from '../../../config/e2e-database-safety';

const SQL_FILES = {
  applyAddresses: '01_add_address_detail_columns.sql',
  rollbackAddresses: '01_rollback_address_detail_columns.sql',
  applySnapshots: '02_add_snapshot_detail_columns.sql',
  rollbackSnapshots: '02_rollback_snapshot_detail_columns.sql',
} as const;

const DETAIL_COLUMNS = ['building', 'floor', 'entrance', 'landmark'] as const;

export function resolveAddressDetailsSqlDir(): string {
  const candidates = [
    join(process.cwd(), 'test/sql/address-details'),
    join(process.cwd(), 'docs/migrations/address-details/sql'),
    join(process.cwd(), '../../docs/migrations/address-details/sql'),
    join(__dirname, '../../../../../../docs/migrations/address-details/sql'),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, SQL_FILES.applyAddresses))) {
      return dir;
    }
  }
  throw new Error('address-details SQL directory was not found');
}

function toPsqlUrl(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);
  parsed.searchParams.delete('schema');
  return parsed.toString();
}

function assertIsolatedAddressDetailsUrl(databaseUrl: string): void {
  assertSafeE2eDatabaseUrl(databaseUrl);
}

function runPsql(databaseUrl: string, sqlFile: string): string {
  assertIsolatedAddressDetailsUrl(databaseUrl);
  if (!existsSync(sqlFile)) {
    throw new Error(`SQL file missing: ${sqlFile}`);
  }
  return execSync('psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SQL_FILE"', {
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL: toPsqlUrl(databaseUrl),
      SQL_FILE: sqlFile,
    },
    timeout: 30_000,
    shell: '/bin/bash',
  });
}

export function applyAddressDetailsSchema(databaseUrl: string): string {
  const dir = resolveAddressDetailsSqlDir();
  const addresses = runPsql(databaseUrl, join(dir, SQL_FILES.applyAddresses));
  const snapshots = runPsql(databaseUrl, join(dir, SQL_FILES.applySnapshots));
  return `${addresses}\n${snapshots}`;
}

/** Destructive. Use only on unused isolated databases. */
export function rollbackAddressDetailsSchema(databaseUrl: string): string {
  const dir = resolveAddressDetailsSqlDir();
  const snapshots = runPsql(databaseUrl, join(dir, SQL_FILES.rollbackSnapshots));
  const addresses = runPsql(databaseUrl, join(dir, SQL_FILES.rollbackAddresses));
  return `${snapshots}\n${addresses}`;
}

function psqlScalar(databaseUrl: string, sql: string): string {
  assertIsolatedAddressDetailsUrl(databaseUrl);
  return execSync('psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -t -A -c "$SQL"', {
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL: toPsqlUrl(databaseUrl),
      SQL: sql,
    },
    timeout: 15_000,
    shell: '/bin/bash',
  }).trim();
}

export function describeAddressDetailColumns(
  databaseUrl: string,
  table: 'addresses' | 'order_delivery_address_snapshots',
): Record<string, { present: boolean; maxLength: string | null }> {
  const result: Record<string, { present: boolean; maxLength: string | null }> =
    {};
  for (const column of DETAIL_COLUMNS) {
    const maxLength = psqlScalar(
      databaseUrl,
      `SELECT character_maximum_length::text
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = '${table}'
         AND column_name = '${column}'`,
    );
    result[column] = {
      present: maxLength.length > 0,
      maxLength: maxLength.length > 0 ? maxLength : null,
    };
  }
  return result;
}
