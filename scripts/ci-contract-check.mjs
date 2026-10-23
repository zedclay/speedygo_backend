#!/usr/bin/env node
/**
 * Compare repository Prisma JSON with isolated emits. Never writes
 * prisma/contract.json or prisma/contract.d.ts. Never migrates or signs.
 *
 * Versioned inputs (must be in the repo):
 *   prisma/contract.prisma
 *   prisma.config.ts
 *   prisma/contract.dzd.prisma
 *   prisma.config.dzd.ts
 *   prisma/contract.json and prisma/contract.d.ts (last signed BigInt emit)
 *
 * Generated on the runner from pinned prisma (pnpm-lock.yaml):
 *   prisma skills (via scripts/prisma-ci-prepare.mjs) — not a Git artifact
 *   isolated emit directories under os.tmpdir()
 *
 * Dual-column runtime switch (optional for this check):
 *   prisma/contract.dzd.json — MONEY_PRISMA_DECIMAL=1 local runtime file.
 *   Its storageHash is a copied BigInt emit, not DZD content. CI BigInt
 *   does not require it; DZD emit uses contract.dzd.prisma.
 *
 * Hash definitions (must not be forced equal):
 *   prisma_contract.marker.core_hash — last migrated/signed contract on a DB
 *   contract.json storage.storageHash — emit of contract.prisma (BigInt)
 *   contract.dzd.json storage.storageHash — copied BigInt emit (not DZD content)
 *   emit --config prisma.config.dzd.ts --output-path — actual DZD prisma emit
 *
 * Does not read workspace-parent docs, local secrets, or DATABASE_URL beyond
 * Prisma config load. Emit uses --output-path and does not connect.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const backend = join(fileURLToPath(new URL('..', import.meta.url)));

/** Prisma config requires DATABASE_URL at load; emit does not connect. */
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    'postgresql://speedygo:speedygo@127.0.0.1:5433/speedygo_test?schema=public';
}

function requireInput(rel) {
  const path = join(backend, rel);
  if (!existsSync(path)) {
    throw new Error(`missing versioned input: ${rel}`);
  }
}

function prepareGeneratedSkills() {
  const result = spawnSync('node', ['scripts/prisma-ci-prepare.mjs'], {
    cwd: backend,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `prisma skills sync failed (${result.status}): ${result.stderr || result.stdout}`,
    );
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function promotionsValue(json) {
  return json.storage?.namespaces?.public?.entries?.table?.promotions?.columns
    ?.value;
}

function emit(args, outDir) {
  const result = spawnSync(
    'pnpm',
    ['exec', 'prisma', 'contract', 'emit', ...args, '--output-path', outDir],
    { cwd: backend, encoding: 'utf8', env: process.env },
  );
  if (result.status !== 0) {
    throw new Error(
      `prisma contract emit failed (${result.status}): ${result.stderr || result.stdout}`,
    );
  }
}

function loadJson(dir) {
  return JSON.parse(readFileSync(join(dir, 'contract.json'), 'utf8'));
}

requireInput('prisma/contract.prisma');
requireInput('prisma.config.ts');
requireInput('prisma/contract.dzd.prisma');
requireInput('prisma.config.dzd.ts');
requireInput('prisma/contract.json');
requireInput('prisma/contract.d.ts');
prepareGeneratedSkills();

const committedJson = join(backend, 'prisma/contract.json');
const committedDts = join(backend, 'prisma/contract.d.ts');
const dzdJsonPath = join(backend, 'prisma/contract.dzd.json');
const beforeJson = sha256(committedJson);
const beforeDts = sha256(committedDts);

const bigintDir = mkdtempSync(join(tmpdir(), 'speedygo-ci-bigint-emit-'));
const dzdDir = mkdtempSync(join(tmpdir(), 'speedygo-ci-dzd-emit-'));
let failed = false;
try {
  emit([], bigintDir);
  emit(['--config', 'prisma.config.dzd.ts'], dzdDir);

  const afterJson = sha256(committedJson);
  const afterDts = sha256(committedDts);
  if (afterJson !== beforeJson || afterDts !== beforeDts) {
    console.error(
      'Refused: emit overwrote prisma/contract.json or contract.d.ts',
    );
    failed = true;
  }

  const committed = JSON.parse(readFileSync(committedJson, 'utf8'));
  const bigintEmit = loadJson(bigintDir);
  const dzdEmit = loadJson(dzdDir);

  const bigintHash = bigintEmit.storage?.storageHash;
  const dzdEmitHash = dzdEmit.storage?.storageHash;
  const dzdJsonPresent = existsSync(dzdJsonPath);
  const copiedHash = dzdJsonPresent
    ? JSON.parse(readFileSync(dzdJsonPath, 'utf8')).storage?.storageHash
    : undefined;

  console.log('bigint emit storageHash', bigintHash);
  console.log('committed contract.json storageHash', committed.storage?.storageHash);
  console.log(
    'committed contract.dzd.json storageHash (copied BigInt emit)',
    dzdJsonPresent ? copiedHash : '(absent; dual-column runtime file not required for this check)',
  );
  console.log('isolated DZD emit storageHash', dzdEmitHash);

  if (bigintHash !== committed.storage?.storageHash) {
    console.error(
      'contract.json storageHash does not match isolated emit of contract.prisma',
    );
    failed = true;
  }

  const bigintValue = promotionsValue(bigintEmit);
  const dzdValue = promotionsValue(dzdEmit);
  if (bigintValue?.nullable !== false) {
    console.error('BigInt emit promotions.value must be NOT NULL', bigintValue);
    failed = true;
  }
  if (dzdValue?.nullable !== true) {
    console.error('DZD emit promotions.value must be nullable', dzdValue);
    failed = true;
  }
  const dzdAmount =
    dzdEmit.storage?.namespaces?.public?.entries?.table?.promotions?.columns
      ?.value_amount;
  if (!dzdAmount || dzdAmount.nullable !== true) {
    console.error('DZD emit must include nullable promotions.value_amount');
    failed = true;
  }
  if (dzdJsonPresent && copiedHash === dzdEmitHash) {
    console.warn(
      'note: copied DZD JSON storageHash equals DZD prisma emit; they measure different inputs',
    );
  }
  if (bigintHash === dzdEmitHash) {
    console.error(
      'BigInt emit hash must not equal DZD prisma emit hash (different contracts)',
    );
    failed = true;
  }

  console.log('promotions.value bigint nullable', bigintValue?.nullable);
  console.log('promotions.value dzd emit nullable', dzdValue?.nullable);
  console.log(
    'dual-column migrate: default BigInt prisma db migrate against SQL 11 hosts fails SCHEMA_VERIFY_FAILED on promotions.value. Do not migrate speedygo_dev / FX / rehearsal. Do not sign or overwrite markers.',
  );
} finally {
  rmSync(bigintDir, { recursive: true, force: true });
  rmSync(dzdDir, { recursive: true, force: true });
}

if (failed) process.exit(1);
console.log('ci-contract-check ok');
