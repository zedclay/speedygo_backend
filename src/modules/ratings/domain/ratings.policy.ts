export const RATING_SCORE_MIN = 1;
export const RATING_SCORE_MAX = 5;

export const RATING_COMMENT_MAX = 2000;

/** API average precision: two decimal places (e.g. 4.33). */
export const RATING_AVERAGE_DECIMAL_PLACES = 2;

export const RATING_TARGET_DRIVER = 'DRIVER';
export const RATING_TARGET_MERCHANT = 'MERCHANT';

export const RATING_TARGETS = [
  RATING_TARGET_DRIVER,
  RATING_TARGET_MERCHANT,
] as const;

export type RatingTargetType = (typeof RATING_TARGETS)[number];

export function parseRatingScore(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    return null;
  }
  if (raw < RATING_SCORE_MIN || raw > RATING_SCORE_MAX) {
    return null;
  }
  return raw;
}

/**
 * Optional comment: omit/null/whitespace → null.
 * Non-empty trimmed text must be ≤ RATING_COMMENT_MAX.
 */
export function normalizeRatingComment(
  raw: string | null | undefined,
): { ok: true; comment: string | null } | { ok: false } {
  if (raw === undefined || raw === null) {
    return { ok: true, comment: null };
  }
  if (typeof raw !== 'string') {
    return { ok: false };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: true, comment: null };
  }
  if (trimmed.length > RATING_COMMENT_MAX) {
    return { ok: false };
  }
  return { ok: true, comment: trimmed };
}

/**
 * Round average to fixed decimal places. Null when count is 0.
 */
export function formatRatingAverage(sum: number, count: number): number | null {
  if (count <= 0) {
    return null;
  }
  const factor = 10 ** RATING_AVERAGE_DECIMAL_PLACES;
  return Math.round((sum / count) * factor) / factor;
}

export function isOrderEligibleForRating(orderStatus: string): boolean {
  return orderStatus === 'COMPLETED';
}

export function isDeliveryEligibleForDriverRating(
  deliveryStatus: string,
): boolean {
  return deliveryStatus === 'DELIVERED';
}

/**
 * Historical serving DriverAssignment for a DELIVERED Delivery.
 *
 * After Driver Delivery Workflow completion, the accepted assignment becomes
 * RELEASED (releasedAt set). REJECTED/EXPIRED/OFFERED rows must never win.
 *
 * ACCEPTED + acceptedAt (releasedAt null) is also accepted only as a rare
 * same-transaction edge; post-completion rows are RELEASED.
 */
export function isHistoricalServingAssignment(assignment: {
  status: string;
  acceptedAt: string | null;
  releasedAt: string | null;
}): boolean {
  if (!assignment.acceptedAt) {
    return false;
  }
  if (assignment.status === 'RELEASED' && assignment.releasedAt !== null) {
    return true;
  }
  if (assignment.status === 'ACCEPTED') {
    return true;
  }
  return false;
}
