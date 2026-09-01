const INSECURE_SECRETS = new Set([
  '',
  'replace_with_local_access_secret',
  'replace_with_local_refresh_secret',
  'changeme',
  'secret',
  'password',
  'otp_hmac_secret',
]);

export type AuthRuntimeConfig = {
  nodeEnv: string;
  jwtAccessSecret: string;
  otpHmacSecret: string;
  otpTransport: string;
};

export function assertAuthSecurityConfig(config: AuthRuntimeConfig): void {
  const production = config.nodeEnv === 'production';

  if (!config.jwtAccessSecret) {
    throw new Error('JWT_ACCESS_SECRET is required');
  }
  if (!config.otpHmacSecret) {
    throw new Error('OTP_HMAC_SECRET is required');
  }
  if (config.jwtAccessSecret === config.otpHmacSecret) {
    throw new Error('JWT_ACCESS_SECRET and OTP_HMAC_SECRET must differ');
  }

  if (production) {
    if (INSECURE_SECRETS.has(config.jwtAccessSecret)) {
      throw new Error('JWT_ACCESS_SECRET is insecure for production');
    }
    if (INSECURE_SECRETS.has(config.otpHmacSecret)) {
      throw new Error('OTP_HMAC_SECRET is insecure for production');
    }
    if (
      config.jwtAccessSecret.length < 32 ||
      config.otpHmacSecret.length < 32
    ) {
      throw new Error('Production auth secrets must be at least 32 characters');
    }
    if (config.otpTransport === 'console' || config.otpTransport === 'test') {
      throw new Error(
        `OTP_TRANSPORT=${config.otpTransport} is forbidden when NODE_ENV=production`,
      );
    }
  }

  if (config.otpTransport === 'console' && production) {
    throw new Error('Console OTP transport cannot run in production');
  }
}
