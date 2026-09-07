/**
 * Shared Delivery Pricing applicability semantics for Checkout selection and
 * Admin activation conflict checks (same-selector principle).
 *
 * Frozen Checkout rules (do not diverge):
 * - Timezone: Africa/Algiers (not server-local; client time never authoritative)
 * - Effective window: half-open [effectiveFrom, effectiveTo) — from included, to excluded
 * - Local window: inclusive on both ends; overnight when start > end
 * - both local times null → all-day
 * - exactly one local time → invalid configuration
 * - timeBand is metadata only (does not invent DAY/NIGHT hours)
 */

export const DELIVERY_PRICING_TIMEZONE = 'Africa/Algiers';

/** Checkout alias — keep existing import sites stable. */
export const CHECKOUT_PRICING_TIMEZONE = DELIVERY_PRICING_TIMEZONE;

export type PricingApplicabilityFields = {
  active: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  timeBand: string;
  startLocalTime: string | null;
  endLocalTime: string | null;
};

export function localTimeOfDaySeconds(
  instant: Date,
  timeZone: string = DELIVERY_PRICING_TIMEZONE,
): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(
    parts.find((part) => part.type === 'minute')?.value ?? '0',
  );
  const second = Number(
    parts.find((part) => part.type === 'second')?.value ?? '0',
  );
  return hour * 3600 + minute * 60 + second;
}

export function parseTimeOfDaySeconds(value: string): number | null {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? '0');
  if (
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    !Number.isInteger(second)
  ) {
    return null;
  }
  return hour * 3600 + minute * 60 + second;
}

/**
 * Inclusive window. When start > end the window wraps midnight.
 */
export function isTimeInWindow(
  nowSeconds: number,
  startSeconds: number,
  endSeconds: number,
): boolean {
  if (startSeconds === endSeconds) {
    return nowSeconds === startSeconds;
  }
  if (startSeconds < endSeconds) {
    return nowSeconds >= startSeconds && nowSeconds <= endSeconds;
  }
  return nowSeconds >= startSeconds || nowSeconds <= endSeconds;
}

export type LocalWindowParseResult =
  | { kind: 'all_day' }
  | { kind: 'invalid' }
  | { kind: 'window'; startSeconds: number; endSeconds: number };

export function parseLocalWindow(
  startLocalTime: string | null,
  endLocalTime: string | null,
): LocalWindowParseResult {
  if (startLocalTime === null && endLocalTime === null) {
    return { kind: 'all_day' };
  }
  if (startLocalTime === null || endLocalTime === null) {
    return { kind: 'invalid' };
  }
  const start = parseTimeOfDaySeconds(startLocalTime);
  const end = parseTimeOfDaySeconds(endLocalTime);
  if (start === null || end === null) {
    return { kind: 'invalid' };
  }
  return { kind: 'window', startSeconds: start, endSeconds: end };
}

/**
 * Seconds-of-day covered by a local window (inclusive endpoints / overnight).
 * Returns null for invalid one-sided/unparseable windows.
 */
export function localWindowSecondSet(
  startLocalTime: string | null,
  endLocalTime: string | null,
): Set<number> | null {
  const parsed = parseLocalWindow(startLocalTime, endLocalTime);
  if (parsed.kind === 'invalid') {
    return null;
  }
  const set = new Set<number>();
  if (parsed.kind === 'all_day') {
    for (let s = 0; s < 86400; s += 1) {
      set.add(s);
    }
    return set;
  }
  for (let s = 0; s < 86400; s += 1) {
    if (isTimeInWindow(s, parsed.startSeconds, parsed.endSeconds)) {
      set.add(s);
    }
  }
  return set;
}

export function isRuleEffectiveAt(
  rule: Pick<
    PricingApplicabilityFields,
    'active' | 'effectiveFrom' | 'effectiveTo'
  >,
  instant: Date,
): boolean {
  if (!rule.active) {
    return false;
  }
  const from = Date.parse(rule.effectiveFrom);
  if (!Number.isFinite(from) || from > instant.getTime()) {
    return false;
  }
  if (!rule.effectiveTo) {
    return true;
  }
  const to = Date.parse(rule.effectiveTo);
  return Number.isFinite(to) && to > instant.getTime();
}

function effectiveIntervalMs(rule: {
  effectiveFrom: string;
  effectiveTo: string | null;
}): { from: number; to: number } | null {
  const from = Date.parse(rule.effectiveFrom);
  if (!Number.isFinite(from)) {
    return null;
  }
  if (!rule.effectiveTo) {
    return { from, to: Number.POSITIVE_INFINITY };
  }
  const to = Date.parse(rule.effectiveTo);
  if (!Number.isFinite(to) || to <= from) {
    return null;
  }
  return { from, to };
}

function effectiveIntervalsOverlap(
  a: { from: number; to: number },
  b: { from: number; to: number },
): { from: number; to: number } | null {
  const from = Math.max(a.from, b.from);
  const to = Math.min(a.to, b.to);
  if (!(from < to)) {
    return null;
  }
  return { from, to };
}

/**
 * True when there exists an instant T at which both rules would be selected
 * by Checkout (same effective + Africa/Algiers local-window semantics).
 *
 * Invalid local windows are treated as conflicting (fail closed).
 * Adjacent inclusive local endpoints that share a second conflict.
 * Adjacent half-open effective ends (A.to === B.from) do not conflict.
 */
export function pricingRulesApplicabilityConflict(
  a: {
    effectiveFrom: string;
    effectiveTo: string | null;
    startLocalTime: string | null;
    endLocalTime: string | null;
  },
  b: {
    effectiveFrom: string;
    effectiveTo: string | null;
    startLocalTime: string | null;
    endLocalTime: string | null;
  },
  timeZone: string = DELIVERY_PRICING_TIMEZONE,
): boolean {
  const intervalA = effectiveIntervalMs(a);
  const intervalB = effectiveIntervalMs(b);
  if (!intervalA || !intervalB) {
    return true;
  }
  const overlap = effectiveIntervalsOverlap(intervalA, intervalB);
  if (!overlap) {
    return false;
  }

  const setA = localWindowSecondSet(a.startLocalTime, a.endLocalTime);
  const setB = localWindowSecondSet(b.startLocalTime, b.endLocalTime);
  if (setA === null || setB === null) {
    return true;
  }
  let shared = false;
  for (const s of setA) {
    if (setB.has(s)) {
      shared = true;
      break;
    }
  }
  if (!shared) {
    return false;
  }

  const durationMs = overlap.to - overlap.from;
  // Any overlap ≥ 24h covers every local second at least once (Algiers has no DST).
  if (durationMs >= 86_400_000) {
    return true;
  }

  const stepMs = 1000;
  for (let t = overlap.from; t < overlap.to; t += stepMs) {
    const local = localTimeOfDaySeconds(new Date(t), timeZone);
    if (setA.has(local) && setB.has(local)) {
      return true;
    }
  }
  return false;
}
