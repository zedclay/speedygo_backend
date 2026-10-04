import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

export const PICKUP_HANDOFF_STATUS_PENDING = 'PENDING';
export const PICKUP_HANDOFF_STATUS_CONSUMED = 'CONSUMED';
export const PICKUP_HANDOFF_STATUS_INVALIDATED = 'INVALIDATED';
export const PICKUP_HANDOFF_STATUS_EXPIRED = 'EXPIRED';
export const PICKUP_HANDOFF_STATUS_LOCKED = 'LOCKED';

export const PICKUP_HANDOFF_STATUSES = [
  PICKUP_HANDOFF_STATUS_PENDING,
  PICKUP_HANDOFF_STATUS_CONSUMED,
  PICKUP_HANDOFF_STATUS_INVALIDATED,
  PICKUP_HANDOFF_STATUS_EXPIRED,
  PICKUP_HANDOFF_STATUS_LOCKED,
] as const;

export type PickupHandoffStatus = (typeof PICKUP_HANDOFF_STATUSES)[number];

export const PICKUP_HANDOFF_TTL_MS = 30 * 60 * 1000;
export const PICKUP_HANDOFF_MAX_ATTEMPTS = 5;
export const PICKUP_HANDOFF_LOCK_DURATION_MS = 15 * 60 * 1000;

export type PickupHandoffRecord = {
  id: string;
  deliveryId: string;
  assignmentId: string;
  assignmentVersion: number;
  codeHash: string;
  codeSealed: string;
  status: PickupHandoffStatus;
  attemptCount: number;
  maxAttempts: number;
  expiresAt: string;
  lockedUntil: string | null;
  consumedAt: string | null;
  consumedByDriverId: string | null;
  createdByAccountId: string | null;
  invalidatedAt: string | null;
  invalidatedReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type MerchantPickupHandoffView = {
  id: string;
  pickupCode: string;
  status: PickupHandoffStatus;
  expiresAt: string;
  assignmentId: string;
  assignmentVersion: number;
  version: number;
  attemptsRemaining: number;
};

export type ConfirmPickupBody = {
  pickupCode?: string;
  assignmentId?: string;
  assignmentVersion?: number;
};

export function generatePickupHandoffCode(): string {
  return randomInt(0, 10_000).toString().padStart(4, '0');
}

export function hashPickupHandoffCode(secret: string, code: string): string {
  return createHmac('sha256', secret).update(code, 'utf8').digest('hex');
}

export function pickupHandoffCodeMatches(
  secret: string,
  code: string,
  storedHash: string,
): boolean {
  const computed = hashPickupHandoffCode(secret, code);
  const a = Buffer.from(computed);
  const b = Buffer.from(storedHash);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function derivePickupHandoffSealKey(secret: string): Buffer {
  return createHash('sha256')
    .update(`${secret}:pickup-handoff-seal`, 'utf8')
    .digest();
}

export function sealPickupHandoffCode(secret: string, code: string): string {
  const key = derivePickupHandoffSealKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function unsealPickupHandoffCode(secret: string, sealed: string): string {
  const payload = Buffer.from(sealed, 'base64');
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  const key = derivePickupHandoffSealKey(secret);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf8');
}

export function pickupHandoffAttemptsRemaining(
  attemptCount: number,
  maxAttempts: number,
): number {
  return Math.max(0, maxAttempts - attemptCount);
}

export function pickupHandoffExpiresAt(now: Date): string {
  return new Date(now.getTime() + PICKUP_HANDOFF_TTL_MS).toISOString();
}

export function pickupHandoffLockedUntil(now: Date): string {
  return new Date(now.getTime() + PICKUP_HANDOFF_LOCK_DURATION_MS).toISOString();
}

export function isPickupHandoffExpired(expiresAt: string, now: Date): boolean {
  return Date.parse(expiresAt) <= now.getTime();
}

export function isPickupHandoffLocked(
  lockedUntil: string | null,
  now: Date,
): boolean {
  return lockedUntil !== null && Date.parse(lockedUntil) > now.getTime();
}

export function toMerchantPickupHandoffView(
  record: PickupHandoffRecord,
  pickupCode: string,
): MerchantPickupHandoffView {
  return {
    id: record.id,
    pickupCode,
    status: record.status,
    expiresAt: record.expiresAt,
    assignmentId: record.assignmentId,
    assignmentVersion: record.assignmentVersion,
    version: record.version,
    attemptsRemaining: pickupHandoffAttemptsRemaining(
      record.attemptCount,
      record.maxAttempts,
    ),
  };
}
