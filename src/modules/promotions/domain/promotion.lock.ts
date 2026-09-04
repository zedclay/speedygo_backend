import { createHash } from 'node:crypto';

/** ASCII 'SGPR' — SpeedyGo Promotion Redemption advisory lock class. */
export const PROMOTION_ADVISORY_LOCK_CLASS = 0x53475052;

export function promotionAdvisoryObjectId(promotionId: string): number {
  const digest = createHash('sha256')
    .update('speedygo.promotion.redeem\0')
    .update(promotionId)
    .digest();
  const value = digest.readInt32BE(0);
  return value === 0 ? 1 : value;
}
