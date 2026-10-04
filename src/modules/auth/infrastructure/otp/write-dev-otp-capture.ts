import {
  chmodSync,
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEV_OTP_CAPTURE_FILENAME = 'otp-last';

export function resolveDevOtpDir(): string {
  const override = process.env.SPEEDYGO_DEV_OTP_DIR?.trim();
  if (override) {
    return override;
  }
  return join(homedir(), '.speedygo', 'dev');
}

export function resolveDevOtpFilePath(): string {
  return join(resolveDevOtpDir(), DEV_OTP_CAPTURE_FILENAME);
}

function assertNotSymlink(path: string, label: string): void {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return;
    }
    throw error;
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`${label} must not be a symlink`);
  }
}

function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  assertNotSymlink(dir, 'Dev OTP directory');
  chmodSync(dir, 0o700);
}

/**
 * Development-only OTP capture. Never used in production.
 * Writes owner-only (0600) into an owner-only directory (0700).
 * Refuses to follow symlinks (including in shared /tmp).
 */
export function writeDevOtpCapture(code: string): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Dev OTP capture refused in production');
  }
  const dir = resolveDevOtpDir();
  const parent = dirname(dir);
  if (parent !== dir) {
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    assertNotSymlink(parent, 'Dev OTP parent directory');
    try {
      chmodSync(parent, 0o700);
    } catch {
      // Parent may already exist with a stricter owner; directory itself is enforced below.
    }
  }
  ensurePrivateDir(dir);
  const path = resolveDevOtpFilePath();
  assertNotSymlink(path, 'Dev OTP capture file');
  let flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC;
  if (typeof constants.O_NOFOLLOW === 'number') {
    flags |= constants.O_NOFOLLOW;
  }
  const fd = openSync(path, flags, 0o600);
  try {
    writeSync(fd, `${code}\n`, 0, 'utf8');
  } finally {
    closeSync(fd);
  }
  chmodSync(path, 0o600);
}
