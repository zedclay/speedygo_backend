#!/usr/bin/env node
/**
 * Generate Prisma 8 skills from the pinned `prisma` CLI (pnpm-lock.yaml).
 * Output is local (typically .cursor/skills) and must not be committed.
 * Does not read workspace-parent docs, .env secrets, or runtime JSON.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const backend = join(fileURLToPath(new URL('..', import.meta.url)));

const result = spawnSync('pnpm', ['exec', 'prisma', 'skills', 'sync'], {
  cwd: backend,
  encoding: 'utf8',
  env: process.env,
  stdio: 'inherit',
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
