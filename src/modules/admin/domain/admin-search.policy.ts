import { ADMIN_PERMISSIONS } from './admin-permissions';
import { adminInvalidInput } from './admin.errors';

export const ADMIN_SEARCH_TYPES = [
  'customers',
  'merchants',
  'drivers',
  'orders',
  'support',
] as const;

export type AdminSearchEntityType = (typeof ADMIN_SEARCH_TYPES)[number];

export const ADMIN_SEARCH_MIN_LENGTH = 2;
export const ADMIN_SEARCH_MAX_LENGTH = 100;
export const ADMIN_SEARCH_DEFAULT_LIMIT_PER_TYPE = 8;
export const ADMIN_SEARCH_MAX_LIMIT_PER_TYPE = 20;

const TYPE_PERMISSION: Record<AdminSearchEntityType, string> = {
  customers: ADMIN_PERMISSIONS.CUSTOMERS_READ,
  merchants: ADMIN_PERMISSIONS.MERCHANTS_READ,
  drivers: ADMIN_PERMISSIONS.DRIVERS_READ,
  orders: ADMIN_PERMISSIONS.ORDERS_READ,
  support: ADMIN_PERMISSIONS.SUPPORT_READ,
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Policy B — strip LIKE metacharacters; no client wildcards. */
export function stripAdminSearchLikeMetacharacters(raw: string): string {
  return raw.replace(/[%_\\]/g, '');
}

export function normalizeAdminSearchQuery(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw adminInvalidInput('q must be a string');
  }
  const normalized = stripAdminSearchLikeMetacharacters(raw.trim()).trim();
  if (normalized.length < ADMIN_SEARCH_MIN_LENGTH) {
    throw adminInvalidInput(
      `q must be at least ${ADMIN_SEARCH_MIN_LENGTH} characters after trim and removal of LIKE wildcards`,
    );
  }
  if (normalized.length > ADMIN_SEARCH_MAX_LENGTH) {
    throw adminInvalidInput(
      `q must be at most ${ADMIN_SEARCH_MAX_LENGTH} characters after trim and removal of LIKE wildcards`,
    );
  }
  return normalized;
}

export function normalizeAdminSearchLimitPerType(raw?: number): number {
  if (raw === undefined || Number.isNaN(raw)) {
    return ADMIN_SEARCH_DEFAULT_LIMIT_PER_TYPE;
  }
  return Math.min(
    ADMIN_SEARCH_MAX_LIMIT_PER_TYPE,
    Math.max(1, Math.floor(raw)),
  );
}

export function parseAdminSearchTypes(
  raw: string | undefined,
): AdminSearchEntityType[] | null {
  if (raw === undefined || raw.trim() === '') {
    return null;
  }
  const wanted = new Set<AdminSearchEntityType>();
  for (const token of raw.split(',')) {
    const t = token.trim().toLowerCase();
    if ((ADMIN_SEARCH_TYPES as readonly string[]).includes(t)) {
      wanted.add(t as AdminSearchEntityType);
    }
  }
  return [...wanted];
}

export function resolvePermittedSearchTypes(
  permissions: readonly string[],
  requested: AdminSearchEntityType[] | null,
): AdminSearchEntityType[] {
  const permitted = ADMIN_SEARCH_TYPES.filter((type) =>
    permissions.includes(TYPE_PERMISSION[type]),
  );
  if (!requested || requested.length === 0) {
    return [...permitted];
  }
  const allow = new Set(permitted);
  return requested.filter((type) => allow.has(type));
}

export function isAdminSearchUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Digits-only form for contains match against stored E.164 phones. */
export function adminSearchPhoneDigits(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 8) {
    return null;
  }
  return digits;
}
