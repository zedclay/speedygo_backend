export const REPORTS_MAX_WINDOW_MS = 93 * 24 * 60 * 60 * 1000; // 93 days UTC
export const REPORTS_LIST_DEFAULT_LIMIT = 50;
export const REPORTS_LIST_MAX_LIMIT = 100;
export const REPORTS_LIST_MAX_OFFSET = 10_000;

/**
 * Reports Foundation v1.0 time semantics:
 * - Request timestamps are RFC3339 / ISO-8601 with explicit offset (UTC preferred).
 * - Interval is half-open [from, to) in absolute UTC instants.
 * - No Algeria/local business timezone interpretation of date-only strings.
 */
export function parseReportInstant(raw: string): Date | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return null;
  }
  const trimmed = raw.trim();
  // Reject bare dates that would be interpreted as local midnight.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    return null;
  }
  return new Date(ms);
}

export function validateReportWindow(
  fromRaw: string,
  toRaw: string,
): { from: Date; to: Date } | { error: string } {
  const from = parseReportInstant(fromRaw);
  const to = parseReportInstant(toRaw);
  if (!from || !to) {
    return {
      error:
        'from/to must be RFC3339 timestamps with timezone (not bare YYYY-MM-DD)',
    };
  }
  if (!(from.getTime() < to.getTime())) {
    return { error: 'from must be strictly before to ([from, to) semantics)' };
  }
  if (to.getTime() - from.getTime() > REPORTS_MAX_WINDOW_MS) {
    return { error: 'Report window must not exceed 93 days' };
  }
  return { from, to };
}

export function normalizeReportListQuery(query: {
  limit?: number;
  offset?: number;
}): { limit: number; offset: number } {
  const rawLimit = query.limit ?? REPORTS_LIST_DEFAULT_LIMIT;
  const rawOffset = query.offset ?? 0;
  const limit = Math.min(
    REPORTS_LIST_MAX_LIMIT,
    Math.max(1, Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 50),
  );
  const offset = Math.min(
    REPORTS_LIST_MAX_OFFSET,
    Math.max(0, Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : 0),
  );
  return { limit, offset };
}

/** Serialize DB bigint/number money as decimal string (no float). */
export function moneyMinorToString(
  value: bigint | number | string | null | undefined,
): string {
  if (value === null || value === undefined) {
    return '0';
  }
  return String(value);
}

/**
 * COD outstanding custody as-of exclusive end `to`.
 * Formula matches COD Foundation: collections − allocations on CONFIRMED remittances,
 * filtered so only events with eventTime < asOfTo count.
 */
export function computeCodOutstandingAsOf(input: {
  collections: Array<{ collectedAt: string; amountMinor: bigint | number }>;
  confirmedAllocations: Array<{
    remittanceConfirmedAt: string;
    amountMinor: bigint | number;
  }>;
  asOfToIso: string;
}): bigint {
  const asOf = Date.parse(input.asOfToIso);
  let collected = 0n;
  for (const row of input.collections) {
    if (Date.parse(row.collectedAt) < asOf) {
      collected += BigInt(row.amountMinor);
    }
  }
  let allocated = 0n;
  for (const row of input.confirmedAllocations) {
    if (Date.parse(row.remittanceConfirmedAt) < asOf) {
      allocated += BigInt(row.amountMinor);
    }
  }
  return collected - allocated;
}

export function computeCodPeriodNetMovement(input: {
  collectedDuringPeriodMinor: bigint | number | string;
  confirmedRemittedDuringPeriodMinor: bigint | number | string;
}): bigint {
  return (
    BigInt(input.collectedDuringPeriodMinor) -
    BigInt(input.confirmedRemittedDuringPeriodMinor)
  );
}
