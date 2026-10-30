/**
 * Prisma 8 JSON selection. Does not emit or mutate contract files.
 *
 * Shared :3000 today: MONEY_PRISMA_DECIMAL=1 → contract.dzd.json (no auth_audience).
 * Isolated audience (BigInt e2e): AUTH_AUDIENCE_PRISMA=1 → contract.audience.json.
 * Isolated combined: both flags → contract.dzd.audience.json on *isolated_money only.
 */
export function selectPrismaContractFile(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const audience = env['AUTH_AUDIENCE_PRISMA'] === '1';
  const money = env['MONEY_PRISMA_DECIMAL'] === '1';
  if (audience && money) {
    return 'contract.dzd.audience.json';
  }
  if (audience) {
    return 'contract.audience.json';
  }
  if (money) {
    return 'contract.dzd.json';
  }
  return 'contract.json';
}

export type ParsedDatabaseUrl = {
  hostname: string;
  port: number;
  database: string;
};

const FORBIDDEN_AUDIENCE_DATABASES = new Set([
  'speedygo_dev',
  'speedygo_parity_fx',
  'speedygo_money_migrate_rehearsal',
  'postgres',
]);

export function parseDatabaseUrl(url: string): ParsedDatabaseUrl {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('AUTH_AUDIENCE_PRISMA=1 refused: DATABASE_URL is not a URL');
  }
  const hostname = parsed.hostname;
  const port = parsed.port ? Number.parseInt(parsed.port, 10) : 5432;
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, '')).split(
    '?',
  )[0];
  return { hostname, port, database };
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
  );
}

/**
 * AUTH_AUDIENCE_PRISMA=1 never opens speedygo_dev / FX / rehearsal.
 * Audience-only: speedygo_test.
 * Combined with MONEY_PRISMA_DECIMAL=1: name must end with isolated_money
 * (not speedygo_test — that DB is still BigInt).
 */
export function assertAudiencePrismaDatabase(
  url: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env['AUTH_AUDIENCE_PRISMA'] !== '1') {
    return;
  }
  const parsed = parseDatabaseUrl(url);
  if (!isLoopback(parsed.hostname)) {
    throw new Error(
      `AUTH_AUDIENCE_PRISMA=1 refused host ${parsed.hostname} (loopback only)`,
    );
  }
  if (parsed.port !== 5433) {
    throw new Error(
      `AUTH_AUDIENCE_PRISMA=1 refused port ${parsed.port} (5433 only)`,
    );
  }
  if (FORBIDDEN_AUDIENCE_DATABASES.has(parsed.database)) {
    throw new Error(
      `AUTH_AUDIENCE_PRISMA=1 refused database ${parsed.database}`,
    );
  }
  const combined = env['MONEY_PRISMA_DECIMAL'] === '1';
  if (combined) {
    if (parsed.database === 'speedygo_test') {
      throw new Error(
        'AUTH_AUDIENCE_PRISMA=1 + MONEY_PRISMA_DECIMAL=1 refused speedygo_test (BigInt e2e)',
      );
    }
    if (!parsed.database.endsWith('isolated_money')) {
      throw new Error(
        `combined audience+money refused database ${parsed.database} (*isolated_money only)`,
      );
    }
    return;
  }
  if (parsed.database !== 'speedygo_test') {
    throw new Error(
      `AUTH_AUDIENCE_PRISMA=1 refused database ${parsed.database} (speedygo_test only)`,
    );
  }
}
