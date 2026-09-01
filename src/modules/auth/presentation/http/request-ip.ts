import type { Request } from 'express';

/**
 * Uses Express `req.ip`.
 * X-Forwarded-For is honoured only when AUTH_TRUST_PROXY=true (trust proxy = 1).
 * Default local/dev: do not trust forwarded headers.
 */
export function clientIp(request: Request): string {
  return request.ip ?? request.socket.remoteAddress ?? 'unknown';
}
