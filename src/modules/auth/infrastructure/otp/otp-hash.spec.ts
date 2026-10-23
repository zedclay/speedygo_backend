import { hmacOtp } from './otp-hash';

describe('hmacOtp audience suffix', () => {
  const base = {
    secret: 'unit-otp-hmac-secret-at-least-32-ch',
    identifier: '+213550123456',
    purpose: 'AUTHENTICATE' as const,
    channel: 'PHONE' as const,
    code: '123456',
  };

  it('keeps the historical digest when audience is absent', () => {
    expect(hmacOtp(base)).toBe(hmacOtp({ ...base, audience: null }));
    expect(hmacOtp(base)).toBe(hmacOtp({ ...base, audience: undefined }));
  });

  it('isolates OTP hashes per requested audience', () => {
    const customer = hmacOtp({ ...base, audience: 'CUSTOMER' });
    const driver = hmacOtp({ ...base, audience: 'DRIVER' });
    expect(customer).not.toBe(driver);
    expect(customer).not.toBe(hmacOtp(base));
  });
});
