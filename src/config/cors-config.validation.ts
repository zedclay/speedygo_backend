import { installCorsAllowlist, parseCorsAllowedOrigins } from './cors.policy';

export type CorsRuntimeConfig = {
  nodeEnv: string;
  allowedOriginsEnv: string | undefined;
};

/**
 * Fail-closed CORS startup validation for every runtime (including development).
 * Open CORS and empty production allowlists are never accepted.
 */
export function assertCorsConfig(config: CorsRuntimeConfig): {
  allowedOrigins: string[];
  originCount: number;
} {
  const raw = config.allowedOriginsEnv;
  if (raw === undefined) {
    throw new Error(
      'CORS_ALLOWED_ORIGINS is required (comma-separated absolute http(s) origins)',
    );
  }
  if (raw.trim().length === 0) {
    throw new Error(
      'CORS_ALLOWED_ORIGINS must contain at least one valid browser origin',
    );
  }

  const allowedOrigins = parseCorsAllowedOrigins(raw);
  if (allowedOrigins.length === 0) {
    throw new Error(
      'CORS_ALLOWED_ORIGINS must contain at least one valid browser origin',
    );
  }

  installCorsAllowlist(allowedOrigins);
  return { allowedOrigins, originCount: allowedOrigins.length };
}
