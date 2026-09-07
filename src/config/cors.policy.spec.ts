import {
  CORS_ALLOWED_METHODS,
  CORS_ALLOWED_REQUEST_HEADERS,
  CORS_CREDENTIALS,
  CORS_EXPOSED_RESPONSE_HEADERS,
  CORS_PREFLIGHT_MAX_AGE_SECONDS,
  createHttpCorsOptions,
  installCorsAllowlist,
  isCorsOriginAllowed,
  normalizeConfiguredOrigin,
  parseCorsAllowedOrigins,
  resetCorsAllowlistForTests,
} from './cors.policy';
import { assertCorsConfig } from './cors-config.validation';

describe('parseCorsAllowedOrigins', () => {
  it('parses one valid HTTPS origin', () => {
    expect(parseCorsAllowedOrigins('https://admin.example.com')).toEqual([
      'https://admin.example.com',
    ]);
  });

  it('parses multiple comma-separated origins', () => {
    expect(
      parseCorsAllowedOrigins(
        'https://admin.example.com,https://merchant.example.com',
      ),
    ).toEqual(['https://admin.example.com', 'https://merchant.example.com']);
  });

  it('trims whitespace around entries', () => {
    expect(
      parseCorsAllowedOrigins(
        '  https://admin.example.com , https://merchant.example.com  ',
      ),
    ).toEqual(['https://admin.example.com', 'https://merchant.example.com']);
  });

  it('deduplicates equivalent origins', () => {
    expect(
      parseCorsAllowedOrigins(
        'https://admin.example.com, https://admin.example.com/',
      ),
    ).toEqual(['https://admin.example.com']);
  });

  it('normalizes a trailing root slash', () => {
    expect(normalizeConfiguredOrigin('https://admin.example.com/')).toBe(
      'https://admin.example.com',
    );
  });

  it('normalizes default HTTPS and HTTP ports', () => {
    expect(normalizeConfiguredOrigin('https://admin.example.com:443')).toBe(
      'https://admin.example.com',
    );
    expect(normalizeConfiguredOrigin('http://localhost:80')).toBe(
      'http://localhost',
    );
  });

  it('lowercases scheme and hostname via URL parsing', () => {
    expect(normalizeConfiguredOrigin('HTTPS://Admin.Example.COM')).toBe(
      'https://admin.example.com',
    );
  });

  it('preserves an explicit non-default port', () => {
    expect(normalizeConfiguredOrigin('http://localhost:5173')).toBe(
      'http://localhost:5173',
    );
  });

  it('rejects an empty value', () => {
    expect(() => parseCorsAllowedOrigins('')).toThrow(/empty entry|at least/i);
  });

  it('rejects an empty list member', () => {
    expect(() =>
      parseCorsAllowedOrigins(
        'https://admin.example.com,,https://b.example.com',
      ),
    ).toThrow(/empty entry/);
  });

  it('rejects a malformed URL', () => {
    expect(() => parseCorsAllowedOrigins('http://')).toThrow(/malformed/);
  });

  it('rejects a wildcard', () => {
    expect(() => parseCorsAllowedOrigins('*')).toThrow(/wildcard/i);
  });

  it('rejects a wildcard subdomain pattern', () => {
    expect(() => parseCorsAllowedOrigins('https://*.example.com')).toThrow(
      /wildcard/i,
    );
  });

  it('rejects credentials in the origin', () => {
    expect(() =>
      parseCorsAllowedOrigins('https://user:pass@admin.example.com'),
    ).toThrow(/credentials/i);
  });

  it('rejects a non-root path', () => {
    expect(() =>
      parseCorsAllowedOrigins('https://admin.example.com/app'),
    ).toThrow(/path/i);
  });

  it('rejects a query string', () => {
    expect(() =>
      parseCorsAllowedOrigins('https://admin.example.com?x=1'),
    ).toThrow(/query|fragment/i);
  });

  it('rejects a fragment', () => {
    expect(() =>
      parseCorsAllowedOrigins('https://admin.example.com#frag'),
    ).toThrow(/query|fragment/i);
  });

  it('rejects a non-HTTP scheme', () => {
    expect(() => parseCorsAllowedOrigins('ftp://admin.example.com')).toThrow(
      /http or https/i,
    );
  });

  it('rejects literal null', () => {
    expect(() => parseCorsAllowedOrigins('null')).toThrow(/null/i);
  });

  it('accepts an origin that is not a deceptive suffix of another', () => {
    // Exact list only — evil suffix is simply a different origin string.
    expect(
      parseCorsAllowedOrigins('https://admin.example.com.evil.test'),
    ).toEqual(['https://admin.example.com.evil.test']);
  });
});

describe('isCorsOriginAllowed', () => {
  beforeEach(() => {
    resetCorsAllowlistForTests();
    installCorsAllowlist([
      'https://admin.example.com',
      'http://localhost:5173',
    ]);
  });

  afterEach(() => {
    resetCorsAllowlistForTests();
  });

  it('allows an exact allowed Origin', () => {
    expect(isCorsOriginAllowed('https://admin.example.com')).toBe(true);
  });

  it('denies the same host with the wrong scheme', () => {
    expect(isCorsOriginAllowed('http://admin.example.com')).toBe(false);
  });

  it('denies the same host with the wrong port', () => {
    expect(isCorsOriginAllowed('http://localhost:5174')).toBe(false);
  });

  it('denies a parent domain', () => {
    expect(isCorsOriginAllowed('https://example.com')).toBe(false);
  });

  it('denies a child subdomain unless explicitly listed', () => {
    expect(isCorsOriginAllowed('https://ops.admin.example.com')).toBe(false);
  });

  it('denies a deceptive suffix domain', () => {
    expect(isCorsOriginAllowed('https://admin.example.com.evil.test')).toBe(
      false,
    );
  });

  it('denies Origin: null', () => {
    expect(isCorsOriginAllowed('null')).toBe(false);
  });

  it('allows a missing Origin through to application security', () => {
    expect(isCorsOriginAllowed(undefined)).toBe(true);
    expect(isCorsOriginAllowed('')).toBe(true);
  });

  it('does not implement wildcard behavior', () => {
    expect(isCorsOriginAllowed('*')).toBe(false);
  });
});

describe('assertCorsConfig', () => {
  afterEach(() => {
    resetCorsAllowlistForTests();
  });

  it('fail-closes when the env var is missing', () => {
    expect(() =>
      assertCorsConfig({ nodeEnv: 'production', allowedOriginsEnv: undefined }),
    ).toThrow(/CORS_ALLOWED_ORIGINS is required/);
  });

  it('fail-closes when the env var is blank', () => {
    expect(() =>
      assertCorsConfig({ nodeEnv: 'production', allowedOriginsEnv: '  ' }),
    ).toThrow(/at least one/);
  });

  it('fail-closes on wildcards in production-like runtime', () => {
    expect(() =>
      assertCorsConfig({
        nodeEnv: 'production',
        allowedOriginsEnv: '*',
      }),
    ).toThrow(/wildcard/i);
  });

  it('installs a valid allowlist', () => {
    const result = assertCorsConfig({
      nodeEnv: 'development',
      allowedOriginsEnv: 'http://localhost:5173',
    });
    expect(result.originCount).toBe(1);
    expect(isCorsOriginAllowed('http://localhost:5173')).toBe(true);
  });
});

describe('createHttpCorsOptions', () => {
  it('freezes credentials=false and conservative preflight settings', () => {
    const options = createHttpCorsOptions();
    expect(options.credentials).toBe(CORS_CREDENTIALS);
    expect(CORS_CREDENTIALS).toBe(false);
    expect(options.maxAge).toBe(CORS_PREFLIGHT_MAX_AGE_SECONDS);
    expect(CORS_PREFLIGHT_MAX_AGE_SECONDS).toBe(600);
    expect(options.optionsSuccessStatus).toBe(204);
    expect(options.methods).toEqual([...CORS_ALLOWED_METHODS]);
    expect(options.allowedHeaders).toEqual([...CORS_ALLOWED_REQUEST_HEADERS]);
    expect(options.exposedHeaders).toEqual([...CORS_EXPOSED_RESPONSE_HEADERS]);
  });
});
