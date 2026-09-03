import { createHash } from 'node:crypto';
import {
  COMMISSION_SCOPE_GLOBAL_DEFAULT,
  COMMISSION_SCOPE_MERCHANT_OVERRIDE,
  type CommissionScope,
} from './merchant-commission.types';

/**
 * PostgreSQL advisory lock class for Merchant Commission configuration.
 * ASCII 'SGCM' (SpeedyGo Commission Management) as signed int4.
 * Server-derived constant — never built from untrusted client strings.
 */
export const MERCHANT_COMMISSION_ADVISORY_LOCK_CLASS = 0x5347434d;

export type MerchantCommissionAdvisoryLockKeys = {
  classId: number;
  objectId: number;
};

/**
 * Deterministic transaction-scoped lock keys for `pg_advisory_xact_lock(classId, objectId)`.
 *
 * - GLOBAL_DEFAULT → objectId = 0 (one global configuration lock)
 * - MERCHANT_OVERRIDE → objectId = SHA-256 int32 of a fixed prefix + merchantId
 *   (never 0, so it cannot collide with the global key)
 *
 * Merchants whose hashes collide only serialize with each other (safe; slightly less parallel).
 */
export function merchantCommissionAdvisoryLockKeys(
  scope: CommissionScope,
  merchantId: string | null,
): MerchantCommissionAdvisoryLockKeys {
  if (scope === COMMISSION_SCOPE_GLOBAL_DEFAULT) {
    return {
      classId: MERCHANT_COMMISSION_ADVISORY_LOCK_CLASS,
      objectId: 0,
    };
  }
  if (scope !== COMMISSION_SCOPE_MERCHANT_OVERRIDE || !merchantId) {
    throw new Error('MERCHANT_OVERRIDE advisory lock requires merchantId');
  }
  const digest = createHash('sha256')
    .update('speedygo.merchant_commission.override\0')
    .update(merchantId)
    .digest();
  let objectId = digest.readInt32BE(0);
  if (objectId === 0) {
    objectId = 1;
  }
  return {
    classId: MERCHANT_COMMISSION_ADVISORY_LOCK_CLASS,
    objectId,
  };
}
