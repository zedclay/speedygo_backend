import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertSafeE2eDatabaseUrl,
  redactDatabaseUrl,
} from '../../../config/e2e-database-safety';

const SQL_FILES = {
  apply: '01_add_session_auth_audience.sql',
  rollback: '01_rollback_session_auth_audience.sql',
  preferredLocale: '02_isolated_admin_preferred_locale.sql',
} as const;

export function resolveSessionAudienceSqlDir(): string {
  const candidates = [
    join(process.cwd(), 'test/sql/auth-audience'),
    join(process.cwd(), 'docs/migrations/auth-audience/sql'),
    join(process.cwd(), '../../docs/migrations/auth-audience/sql'),
    join(__dirname, '../../../../../../docs/migrations/auth-audience/sql'),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, SQL_FILES.apply))) {
      return dir;
    }
  }
  throw new Error('auth-audience SQL directory was not found');
}

function toPsqlUrl(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);
  parsed.searchParams.delete('schema');
  return parsed.toString();
}

function runPsql(databaseUrl: string, sqlFile: string): string {
  assertSafeE2eDatabaseUrl(databaseUrl);
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

export function applySessionAudienceSchema(databaseUrl: string): string {
  const sql = join(resolveSessionAudienceSqlDir(), SQL_FILES.apply);
  return runPsql(databaseUrl, sql);
}

export function rollbackSessionAudienceSchema(databaseUrl: string): string {
  const sql = join(resolveSessionAudienceSqlDir(), SQL_FILES.rollback);
  return runPsql(databaseUrl, sql);
}

/** Isolated speedygo_test only. Do not use to mutate speedygo_dev. */
export function applyIsolatedPreferredLocale(databaseUrl: string): string {
  const sql = join(resolveSessionAudienceSqlDir(), SQL_FILES.preferredLocale);
  return runPsql(databaseUrl, sql);
}

export function reconcileIsolatedAuthAudienceDb(databaseUrl: string): void {
  applySessionAudienceSchema(databaseUrl);
  applyIsolatedPreferredLocale(databaseUrl);
}

function psqlScalar(databaseUrl: string, sql: string): string {
  assertSafeE2eDatabaseUrl(databaseUrl);
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

export function describeSessionAudienceColumn(databaseUrl: string): {
  present: boolean;
  isNullable: string | null;
  maxLength: string | null;
  checkDef: string | null;
} {
  void redactDatabaseUrl(databaseUrl);
  const column = psqlScalar(
    databaseUrl,
    [
      'SELECT column_name || \'|\' || is_nullable || \'|\' ||',
      "COALESCE(character_maximum_length::text, '')",
      'FROM information_schema.columns',
      "WHERE table_schema = 'public'",
      "AND table_name = 'sessions'",
      "AND column_name = 'auth_audience'",
    ].join(' '),
  );
  const checkDef =
    psqlScalar(
      databaseUrl,
      "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'sessions_auth_audience_chk'",
    ) || null;
  if (!column) {
    return {
      present: false,
      isNullable: null,
      maxLength: null,
      checkDef,
    };
  }
  const [name, nullable, maxLength] = column.split('|');
  return {
    present: name === 'auth_audience',
    isNullable: nullable || null,
    maxLength: maxLength || null,
    checkDef,
  };
}

export function preferredLocaleColumnPresent(databaseUrl: string): boolean {
  const name = psqlScalar(
    databaseUrl,
    [
      'SELECT column_name FROM information_schema.columns',
      "WHERE table_schema = 'public'",
      "AND table_name = 'admin_profiles'",
      "AND column_name = 'preferred_locale'",
    ].join(' '),
  );
  return name === 'preferred_locale';
}
