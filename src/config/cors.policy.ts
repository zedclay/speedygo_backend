import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/** Fixed preflight cache for v1.0 (seconds). Not an Admin Setting. */
export const CORS_PREFLIGHT_MAX_AGE_SECONDS = 600;

/** Browser credentials are not used — auth is Bearer JSON, not cookies. */
export const CORS_CREDENTIALS = false;

export const CORS_ALLOWED_METHODS = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
] as const;

/**
 * Minimal request headers used by SpeedyGo browser clients.
 * Provider webhook signature headers are server-to-server and are not listed.
 */
export const CORS_ALLOWED_REQUEST_HEADERS = [
  'Authorization',
  'Content-Type',
  'Accept',
] as const;

/** Admin document downloads expose Content-Disposition to browser clients. */
export const CORS_EXPOSED_RESPONSE_HEADERS = ['Content-Disposition'] as const;

export const CORS_PREFLIGHT_SUCCESS_STATUS = 204;

let installedAllowlist: ReadonlySet<string> | null = null;

export function installCorsAllowlist(origins: readonly string[]): void {
  installedAllowlist = new Set(origins);
}

export function getInstalledCorsAllowlist(): ReadonlySet<string> {
  if (!installedAllowlist) {
    throw new Error('CORS allowlist is not installed');
  }
  return installedAllowlist;
}

export function resetCorsAllowlistForTests(): void {
  installedAllowlist = null;
}

/**
 * Parse and normalize `CORS_ALLOWED_ORIGINS` (comma-separated absolute origins).
 * Fail closed on any invalid entry — never returns a partial silent allowlist.
 */
export function parseCorsAllowedOrigins(raw: string): string[] {
  const parts = raw.split(',');
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length === 0) {
      throw new Error(
        'CORS_ALLOWED_ORIGINS contains an empty entry (check commas)',
      );
    }
    const origin = normalizeConfiguredOrigin(trimmed);
    if (!seen.has(origin)) {
      seen.add(origin);
      normalized.push(origin);
    }
  }

  return normalized;
}

export function normalizeConfiguredOrigin(value: string): string {
  if (value === '*' || value.includes('*')) {
    throw new Error('CORS_ALLOWED_ORIGINS must not contain wildcards');
  }
  if (value === 'null' || value.toLowerCase() === 'null') {
    throw new Error('CORS_ALLOWED_ORIGINS must not contain null');
  }
  if (/[\s<>'"`\\]/.test(value)) {
    throw new Error('CORS_ALLOWED_ORIGINS contains illegal characters');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('CORS_ALLOWED_ORIGINS contains a malformed origin');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('CORS_ALLOWED_ORIGINS entries must use http or https');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('CORS_ALLOWED_ORIGINS must not include credentials');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new Error(
      'CORS_ALLOWED_ORIGINS must not include query or fragment components',
    );
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('CORS_ALLOWED_ORIGINS must not include a non-root path');
  }

  return url.origin;
}

/**
 * Normalize a browser Origin header for exact allowlist comparison.
 * Returns null when the header is not a valid absolute http(s) origin.
 */
export function normalizeRequestOrigin(originHeader: string): string | null {
  if (originHeader === 'null' || originHeader.toLowerCase() === 'null') {
    return null;
  }
  try {
    return normalizeConfiguredOrigin(originHeader);
  } catch {
    return null;
  }
}

/**
 * Decide whether a browser Origin is CORS-approved.
 * Missing Origin (undefined/empty) → allowed through CORS (native/S2S/webhooks).
 * Explicit `null` and any non-allowlisted value → denied.
 */
export function isCorsOriginAllowed(
  originHeader: string | undefined | null,
): boolean {
  if (
    originHeader === undefined ||
    originHeader === null ||
    originHeader === ''
  ) {
    return true;
  }
  const allowlist = getInstalledCorsAllowlist();
  const normalized = normalizeRequestOrigin(originHeader);
  if (normalized === null) {
    return false;
  }
  return allowlist.has(normalized);
}

type OriginCallback = (err: Error | null, allow?: boolean) => void;

/** Shared HTTP + Socket.IO origin callback — never throws into Nest as a 500. */
export function corsOriginDelegate(
  origin: string | undefined,
  callback: OriginCallback,
): void {
  try {
    callback(null, isCorsOriginAllowed(origin));
  } catch {
    callback(null, false);
  }
}

export function createHttpCorsOptions(): CorsOptions {
  return {
    origin: corsOriginDelegate,
    methods: [...CORS_ALLOWED_METHODS],
    allowedHeaders: [...CORS_ALLOWED_REQUEST_HEADERS],
    exposedHeaders: [...CORS_EXPOSED_RESPONSE_HEADERS],
    credentials: CORS_CREDENTIALS,
    maxAge: CORS_PREFLIGHT_MAX_AGE_SECONDS,
    optionsSuccessStatus: CORS_PREFLIGHT_SUCCESS_STATUS,
  };
}

/** Same allowlist/decision as HTTP — prevents HTTP/Socket.IO drift. */
export function createSocketIoCorsOptions(): {
  origin: typeof corsOriginDelegate;
  credentials: boolean;
  methods: string[];
  allowedHeaders: string[];
} {
  return {
    origin: corsOriginDelegate,
    credentials: CORS_CREDENTIALS,
    methods: [...CORS_ALLOWED_METHODS],
    allowedHeaders: [...CORS_ALLOWED_REQUEST_HEADERS],
  };
}

/**
 * Engine.IO rejects disallowed Origins server-side (browser CORS headers alone
 * do not stop Node clients that forge Origin on websocket upgrades).
 */
export function socketIoAllowRequest(
  req: { headers: { origin?: string | string[] } },
  callback: (err: string | null, success: boolean) => void,
): void {
  try {
    const raw = req.headers.origin;
    const origin = Array.isArray(raw) ? raw[0] : raw;
    callback(null, isCorsOriginAllowed(origin));
  } catch {
    callback(null, false);
  }
}

export function createSocketIoServerOptions(): {
  cors: ReturnType<typeof createSocketIoCorsOptions>;
  allowRequest: typeof socketIoAllowRequest;
} {
  return {
    cors: createSocketIoCorsOptions(),
    allowRequest: socketIoAllowRequest,
  };
}
