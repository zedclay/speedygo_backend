import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeDevOtpCapture } from './write-dev-otp-capture';

describe('writeDevOtpCapture', () => {
  let previousDir: string | undefined;
  let previousNodeEnv: string | undefined;
  let root: string;

  beforeEach(() => {
    previousDir = process.env.SPEEDYGO_DEV_OTP_DIR;
    previousNodeEnv = process.env.NODE_ENV;
    root = mkdtempSync(join(tmpdir(), 'speedygo-dev-otp-'));
    chmodSync(root, 0o700);
    process.env.SPEEDYGO_DEV_OTP_DIR = join(root, 'dev');
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    if (previousDir === undefined) {
      delete process.env.SPEEDYGO_DEV_OTP_DIR;
    } else {
      process.env.SPEEDYGO_DEV_OTP_DIR = previousDir;
    }
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    rmSync(root, { recursive: true, force: true });
  });

  it('creates an owner-only directory and file', () => {
    writeDevOtpCapture('000000');
    const dir = process.env.SPEEDYGO_DEV_OTP_DIR!;
    const file = join(dir, 'otp-last');
    expect((lstatSync(dir).mode & 0o777).toString(8)).toBe('700');
    expect((lstatSync(file).mode & 0o777).toString(8)).toBe('600');
    expect(lstatSync(file).isSymbolicLink()).toBe(false);
    expect(readFileSync(file, 'utf8').trim()).toHaveLength(6);
  });

  it('refuses to write through a capture-file symlink', () => {
    const dir = process.env.SPEEDYGO_DEV_OTP_DIR!;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const target = join(root, 'outside');
    writeFileSync(target, 'keep\n', { mode: 0o600 });
    symlinkSync(target, join(dir, 'otp-last'));
    expect(() => writeDevOtpCapture('111111')).toThrow(/symlink/);
    expect(readFileSync(target, 'utf8')).toBe('keep\n');
  });

  it('refuses production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => writeDevOtpCapture('000000')).toThrow(/production/);
  });
});
