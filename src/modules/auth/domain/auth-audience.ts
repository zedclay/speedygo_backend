export const AUTH_AUDIENCES = [
  'CUSTOMER',
  'MERCHANT',
  'DRIVER',
  'ADMIN',
] as const;

export type AuthAudience = (typeof AUTH_AUDIENCES)[number];

const HEADER_NAME = 'x-speedygo-app';

export const AUTH_APP_HEADER = 'X-SpeedyGo-App';

export function isAuthAudience(value: unknown): value is AuthAudience {
  return (
    typeof value === 'string' &&
    (AUTH_AUDIENCES as readonly string[]).includes(value)
  );
}

/** Header is an untrusted requested surface. It never grants privileges. */
export function parseAuthAudience(raw: unknown): AuthAudience | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const normalized = raw.trim().toUpperCase();
  return isAuthAudience(normalized) ? normalized : null;
}

export function readAuthAudienceHeader(
  headers: { [key: string]: unknown } | undefined,
): unknown {
  if (!headers) {
    return undefined;
  }
  const direct = headers[AUTH_APP_HEADER] ?? headers[HEADER_NAME];
  if (Array.isArray(direct)) {
    return direct[0];
  }
  return direct;
}
