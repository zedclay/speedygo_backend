import { assertAuthSecurityConfig } from './auth-config.validation';

describe('assertAuthSecurityConfig', () => {
  it('allows explicit development placeholders', () => {
    expect(() =>
      assertAuthSecurityConfig({
        nodeEnv: 'development',
        jwtAccessSecret: 'replace_with_local_access_secret',
        otpHmacSecret: 'replace_with_local_otp_hmac_secret',
        otpTransport: 'console',
      }),
    ).not.toThrow();
  });

  it('refuses console OTP and placeholder secrets in production', () => {
    expect(() =>
      assertAuthSecurityConfig({
        nodeEnv: 'production',
        jwtAccessSecret: 'replace_with_local_access_secret',
        otpHmacSecret: 'a-very-long-production-otp-hmac-secret!!',
        otpTransport: 'disabled',
      }),
    ).toThrow(/insecure/);
    expect(() =>
      assertAuthSecurityConfig({
        nodeEnv: 'production',
        jwtAccessSecret: 'a-very-long-production-jwt-access-secret!!',
        otpHmacSecret: 'a-very-long-production-otp-hmac-secret!!',
        otpTransport: 'console',
      }),
    ).toThrow(/forbidden/);
  });
});
