export const SUPPORT_STATUS_OPEN = 'OPEN';
export const SUPPORT_STATUS_IN_PROGRESS = 'IN_PROGRESS';
export const SUPPORT_STATUS_WAITING_CUSTOMER = 'WAITING_CUSTOMER';
export const SUPPORT_STATUS_RESOLVED = 'RESOLVED';
export const SUPPORT_STATUS_CLOSED = 'CLOSED';

export const SUPPORT_STATUSES = [
  SUPPORT_STATUS_OPEN,
  SUPPORT_STATUS_IN_PROGRESS,
  SUPPORT_STATUS_WAITING_CUSTOMER,
  SUPPORT_STATUS_RESOLVED,
  SUPPORT_STATUS_CLOSED,
] as const;

export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const SUPPORT_PRIORITY_LOW = 'LOW';
export const SUPPORT_PRIORITY_NORMAL = 'NORMAL';
export const SUPPORT_PRIORITY_HIGH = 'HIGH';

export const SUPPORT_PRIORITIES = [
  SUPPORT_PRIORITY_LOW,
  SUPPORT_PRIORITY_NORMAL,
  SUPPORT_PRIORITY_HIGH,
] as const;

export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

/** Statuses where a user (Customer/Driver/Merchant) may reply. */
export const SUPPORT_USER_REPLY_STATUSES = [
  SUPPORT_STATUS_OPEN,
  SUPPORT_STATUS_IN_PROGRESS,
  SUPPORT_STATUS_WAITING_CUSTOMER,
] as const;

/** Statuses from which Admin may resolve. */
export const SUPPORT_RESOLVABLE_STATUSES = [
  SUPPORT_STATUS_OPEN,
  SUPPORT_STATUS_IN_PROGRESS,
  SUPPORT_STATUS_WAITING_CUSTOMER,
] as const;

export function parseSupportStatus(raw: string): SupportStatus | null {
  return (SUPPORT_STATUSES as readonly string[]).includes(raw)
    ? (raw as SupportStatus)
    : null;
}

export function parseSupportPriority(raw: string): SupportPriority | null {
  return (SUPPORT_PRIORITIES as readonly string[]).includes(raw)
    ? (raw as SupportPriority)
    : null;
}

export function canUserReply(status: SupportStatus): boolean {
  return (SUPPORT_USER_REPLY_STATUSES as readonly string[]).includes(status);
}

/**
 * User reply side-effect: WAITING_CUSTOMER → IN_PROGRESS; otherwise unchanged.
 * Caller must already have validated canUserReply.
 */
export function statusAfterUserReply(status: SupportStatus): SupportStatus {
  if (status === SUPPORT_STATUS_WAITING_CUSTOMER) {
    return SUPPORT_STATUS_IN_PROGRESS;
  }
  return status;
}

export function canAdminStart(status: SupportStatus): boolean {
  return status === SUPPORT_STATUS_OPEN;
}

export function canAdminWaitCustomer(status: SupportStatus): boolean {
  return (
    status === SUPPORT_STATUS_OPEN || status === SUPPORT_STATUS_IN_PROGRESS
  );
}

export function canAdminResolve(status: SupportStatus): boolean {
  return (SUPPORT_RESOLVABLE_STATUSES as readonly string[]).includes(status);
}

export function canAdminClose(status: SupportStatus): boolean {
  return status === SUPPORT_STATUS_RESOLVED;
}

export function canAdminReopen(status: SupportStatus): boolean {
  return status === SUPPORT_STATUS_RESOLVED || status === SUPPORT_STATUS_CLOSED;
}

export function normalizeSupportListQuery(query: {
  limit?: number;
  offset?: number;
}): { limit: number; offset: number } {
  const rawLimit = query.limit ?? 50;
  const rawOffset = query.offset ?? 0;
  const limit = Math.min(
    100,
    Math.max(1, Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 50),
  );
  const offset = Math.min(
    10_000,
    Math.max(0, Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : 0),
  );
  return { limit, offset };
}

export function isValidSupportBody(body: string): boolean {
  const trimmed = body.trim();
  return trimmed.length >= 1 && trimmed.length <= 4000;
}
