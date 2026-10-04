#!/usr/bin/env node
/**
 * Idempotent Algeria wilaya/commune catalogue import.
 * Upserts by primary key. Never truncates. Not run on API startup.
 *
 * Locked to local Compose Postgres (127.0.0.1 / localhost :5433).
 * Default database: speedygo_dev. Override with GEO_IMPORT_DATABASE.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(ROOT, '..');
const DEFAULT_JSON = join(
  BACKEND,
  'data/geo/algeria_69_wilayas_1541_communes.json',
);
const EXPECTED_SHA256 =
  '92fa211dcb606e7e9d83f3c426bd3a80930cacef74ecb9fded00b6de2a3e5f55';
const EXPECTED_WILAYAS = 69;
const EXPECTED_COMMUNES = 1541;

const HOST = process.env.GEO_IMPORT_PGHOST || '127.0.0.1';
const PORT = process.env.GEO_IMPORT_PGPORT || '5433';
const DB = process.env.GEO_IMPORT_DATABASE || 'speedygo_dev';
const USER = process.env.GEO_IMPORT_PGUSER || 'speedygo';
const PGPASSWORD = process.env.PGPASSWORD || 'speedygo';

const forceUnverified = process.argv.includes('--force-unverified');
const jsonPath = resolve(
  process.env.GEO_ALGERIA_JSON || DEFAULT_JSON,
);

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!['127.0.0.1', 'localhost'].includes(HOST) || PORT !== '5433') {
  fail(
    `Refused: geo import is locked to 127.0.0.1|localhost:5433 (got ${HOST}:${PORT})`,
  );
}
if (!['speedygo_dev', 'speedygo_test'].includes(DB)) {
  fail(
    `Refused: geo import database must be speedygo_dev or speedygo_test (got ${DB})`,
  );
}

const raw = readFileSync(jsonPath);
const sha256 = createHash('sha256').update(raw).digest('hex');
const dataset = JSON.parse(raw.toString('utf8'));

const wilayas = dataset.wilayas ?? [];
const communes = dataset.communes ?? [];
const meta = dataset.metadata ?? {};

const blockers = [];
if (sha256 !== EXPECTED_SHA256) {
  blockers.push(
    `SHA-256 mismatch: expected ${EXPECTED_SHA256}, got ${sha256}`,
  );
}
if (wilayas.length !== EXPECTED_WILAYAS) {
  blockers.push(
    `Wilaya count: expected ${EXPECTED_WILAYAS}, got ${wilayas.length}`,
  );
}
if (communes.length !== EXPECTED_COMMUNES) {
  blockers.push(
    `Commune count: expected ${EXPECTED_COMMUNES}, got ${communes.length}`,
  );
}
if (meta.wilaya_count !== EXPECTED_WILAYAS || meta.commune_count !== EXPECTED_COMMUNES) {
  blockers.push(
    `Metadata totals mismatch: wilaya_count=${meta.wilaya_count} commune_count=${meta.commune_count}`,
  );
}

const wilayaCodes = new Set();
for (const w of wilayas) {
  if (typeof w.code !== 'string' || !/^\d{2}$/.test(w.code)) {
    blockers.push(`Invalid wilaya code: ${JSON.stringify(w.code)}`);
  }
  if (wilayaCodes.has(w.code)) {
    blockers.push(`Duplicate wilaya code: ${w.code}`);
  }
  wilayaCodes.add(w.code);
}

const communeIds = new Set();
for (const c of communes) {
  if (!Number.isInteger(c.id) || c.id < 1) {
    blockers.push(`Invalid commune id: ${JSON.stringify(c.id)}`);
  }
  if (communeIds.has(c.id)) {
    blockers.push(`Duplicate commune id: ${c.id}`);
  }
  communeIds.add(c.id);
  if (!wilayaCodes.has(c.wilaya_code)) {
    blockers.push(
      `Orphan commune ${c.id}: wilaya_code ${c.wilaya_code} not in wilayas`,
    );
  }
}

if (blockers.length > 0 && !forceUnverified) {
  fail(
    `Import refused (integrity). Pass --force-unverified only after documenting blockers:\n- ${blockers.join('\n- ')}`,
  );
}
if (blockers.length > 0) {
  console.warn('Proceeding with --force-unverified despite blockers:');
  for (const b of blockers) console.warn(`- ${b}`);
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJson(value) {
  if (value === null || value === undefined) return 'NULL';
  return `${sqlLiteral(JSON.stringify(value))}::jsonb`;
}

const now = new Date().toISOString();
const statements = [
  'BEGIN;',
  ...wilayas.map(
    (w) =>
      `INSERT INTO wilayas (code, name_fr, name_ar, created_at, updated_at) VALUES (${sqlLiteral(w.code)}, ${sqlLiteral(w.name_fr)}, ${sqlLiteral(w.name_ar)}, ${sqlLiteral(now)}::timestamptz, ${sqlLiteral(now)}::timestamptz) ON CONFLICT (code) DO UPDATE SET name_fr = EXCLUDED.name_fr, name_ar = EXCLUDED.name_ar, updated_at = EXCLUDED.updated_at;`,
  ),
  ...communes.map((c) => {
    const aliases =
      Array.isArray(c.aliases_fr) && c.aliases_fr.length > 0
        ? c.aliases_fr
        : null;
    return `INSERT INTO communes (id, wilaya_code, name_fr, name_ar, aliases_fr, created_at, updated_at) VALUES (${c.id}, ${sqlLiteral(c.wilaya_code)}, ${sqlLiteral(c.name_fr)}, ${sqlLiteral(c.name_ar)}, ${sqlJson(aliases)}, ${sqlLiteral(now)}::timestamptz, ${sqlLiteral(now)}::timestamptz) ON CONFLICT (id) DO UPDATE SET wilaya_code = EXCLUDED.wilaya_code, name_fr = EXCLUDED.name_fr, name_ar = EXCLUDED.name_ar, aliases_fr = EXCLUDED.aliases_fr, updated_at = EXCLUDED.updated_at;`;
  }),
  'COMMIT;',
];

const sql = statements.join('\n');

function runPsql(input) {
  const env = { ...process.env, PGPASSWORD };
  const args = [
    '--no-psqlrc',
    '-v',
    'ON_ERROR_STOP=1',
    '-h',
    HOST,
    '-p',
    PORT,
    '-U',
    USER,
    '-d',
    DB,
  ];
  const result = spawnSync('psql', args, {
    env,
    encoding: 'utf8',
    input,
  });
  if (result.status === 0) {
    return (result.stdout || '').trim();
  }
  if (result.error?.code === 'ENOENT') {
    const dockerArgs = [
      'exec',
      '-i',
      '-e',
      `PGPASSWORD=${PGPASSWORD}`,
      'speedygo-postgres',
      'psql',
      '--no-psqlrc',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      USER,
      '-d',
      DB,
    ];
    const docker = spawnSync('docker', dockerArgs, {
      env,
      encoding: 'utf8',
      input,
    });
    if (docker.status !== 0) {
      fail(docker.stderr || docker.stdout || 'docker psql failed');
    }
    return (docker.stdout || '').trim();
  }
  fail(result.stderr || result.stdout || 'psql failed');
}

runPsql(sql);

const counts = runPsql(
  `SELECT (SELECT COUNT(*)::text FROM wilayas) AS wilayas, (SELECT COUNT(*)::text FROM communes) AS communes;`,
);
console.log(
  JSON.stringify(
    {
      ok: true,
      database: DB,
      file: jsonPath,
      sha256,
      imported: { wilayas: wilayas.length, communes: communes.length },
      databaseCounts: counts,
      rerunSafe: true,
    },
    null,
    2,
  ),
);
