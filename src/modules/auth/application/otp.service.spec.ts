import { ConfigService } from '@nestjs/config';
import { AuthError, AUTH_ERROR_CODES } from '../domain/auth.errors';
import { TestOtpSender } from '../infrastructure/otp/test-otp.sender';
import { hmacOtp } from '../infrastructure/otp/otp-hash';
import { MemoryOtpStore } from '../infrastructure/otp/memory-otp.store';
import { AuthSecurityLogger } from './auth-security.logger';
import { OtpService } from './otp.service';

const SECRET = 'unit-otp-hmac-secret-value-32chars!!';

function service(store = new MemoryOtpStore(), sender = new TestOtpSender()) {
  const config = {
    get: (key: string, fallback?: unknown) => {
      const map: Record<string, unknown> = {
        'auth.otpHmacSecret': SECRET,
        'auth.defaultCountry': 'DZ',
        'auth.otpMaxRequestsPerHour': 5,
        'auth.otpMaxRequestsPerIpPerHour': 20,
        'auth.otpTtlSeconds': 300,
        'auth.otpResendCooldownSeconds': 60,
        'auth.otpMaxAttempts': 5,
      };
      return map[key] ?? fallback;
    },
  } as ConfigService;
  return {
    otp: new OtpService(store, sender, config, new AuthSecurityLogger()),
    store,
    sender,
  };
}

describe('OtpService', () => {
  it('delivers a valid OTP and consumes it once', async () => {
    const { otp, store, sender } = service();
    await otp.request({
      channel: 'PHONE',
      identifier: '0550123456',
      purpose: 'AUTHENTICATE',
      ip: '127.0.0.1',
    });
    expect(sender.lastCode).toMatch(/^\d{6}$/);
    const raw = JSON.stringify([...store.challenges.values()][0]?.challenge);
    expect(raw).not.toContain(sender.lastCode);
    const identifier = await otp.consume({
      channel: 'PHONE',
      identifier: '0550123456',
      purpose: 'AUTHENTICATE',
      code: sender.lastCode!,
    });
    expect(identifier).toBe('+213550123456');
    await expect(
      otp.consume({
        channel: 'PHONE',
        identifier: '0550123456',
        purpose: 'AUTHENTICATE',
        code: sender.lastCode!,
      }),
    ).rejects.toMatchObject({ code: AUTH_ERROR_CODES.AUTH_OTP_EXPIRED });
  });

  it('rejects an invalid OTP and expires after max attempts', async () => {
    const { otp } = service();
    await otp.request({
      channel: 'EMAIL',
      identifier: 'User@Example.COM',
      purpose: 'AUTHENTICATE',
      ip: '10.0.0.1',
    });
    for (let i = 0; i < 4; i += 1) {
      await expect(
        otp.consume({
          channel: 'EMAIL',
          identifier: 'user@example.com',
          purpose: 'AUTHENTICATE',
          code: '000000',
        }),
      ).rejects.toMatchObject({ code: AUTH_ERROR_CODES.AUTH_INVALID_OTP });
    }
    await expect(
      otp.consume({
        channel: 'EMAIL',
        identifier: 'user@example.com',
        purpose: 'AUTHENTICATE',
        code: '000000',
      }),
    ).rejects.toMatchObject({
      code: AUTH_ERROR_CODES.AUTH_OTP_ATTEMPTS_EXCEEDED,
    });
  });

  it('enforces resend cooldown and hourly rate limits', async () => {
    const { otp } = service();
    const req = {
      channel: 'PHONE' as const,
      identifier: '0550123456',
      purpose: 'AUTHENTICATE' as const,
      ip: '8.8.8.8',
    };
    await otp.request(req);
    await expect(otp.request(req)).rejects.toBeInstanceOf(AuthError);
    await expect(otp.request(req)).rejects.toMatchObject({
      code: AUTH_ERROR_CODES.AUTH_RATE_LIMITED,
    });
  });

  it('treats an expired challenge as missing', async () => {
    const store = new MemoryOtpStore();
    const sender = new TestOtpSender();
    const { otp } = service(store, sender);
    await otp.request({
      channel: 'PHONE',
      identifier: '0550123456',
      purpose: 'AUTHENTICATE',
      ip: '1.1.1.1',
    });
    const key = [...store.challenges.keys()][0];
    const entry = store.challenges.get(key)!;
    entry.expiresAtMs = Date.now() - 1;
    await expect(
      otp.consume({
        channel: 'PHONE',
        identifier: '0550123456',
        purpose: 'AUTHENTICATE',
        code: sender.lastCode!,
      }),
    ).rejects.toMatchObject({ code: AUTH_ERROR_CODES.AUTH_OTP_EXPIRED });
  });

  it('uses HMAC context so raw SHA-256 of the code is not stored', async () => {
    const { store, sender, otp } = service();
    await otp.request({
      channel: 'PHONE',
      identifier: '0550123456',
      purpose: 'AUTHENTICATE',
      ip: '1.2.3.4',
    });
    const stored = [...store.challenges.values()][0].challenge.codeHash;
    const expected = hmacOtp({
      secret: SECRET,
      identifier: '+213550123456',
      purpose: 'AUTHENTICATE',
      channel: 'PHONE',
      code: sender.lastCode!,
    });
    expect(stored).toBe(expected);
    expect(stored).not.toBe(sender.lastCode);
  });
});
