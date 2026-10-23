import type { AuthAudience } from './auth-audience';

/**
 * Path prefix → required token/session audience.
 * Unmapped authenticated routes (`/auth/*`, `/geo/*`, uploads) stay
 * audience-agnostic so session restore is not locked to one app.
 */
export function requiredAudienceForPath(path: string): AuthAudience | null {
  const stripped = path
    .split('?')[0]
    .replace(/^\/api\/v1(?=\/|$)/, '')
    .replace(/\/+$/, '');
  const first = stripped.split('/').filter(Boolean)[0];
  switch (first) {
    case 'customer':
      return 'CUSTOMER';
    case 'merchant':
      return 'MERCHANT';
    case 'driver':
      return 'DRIVER';
    case 'admin':
      return 'ADMIN';
    default:
      return null;
  }
}
