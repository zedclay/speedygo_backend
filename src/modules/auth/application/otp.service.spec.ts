import { ConfigService } from '@nestjs/config';
import { AuthError, AUTH_ERROR_CODES } from '../domain/auth.errors';
import type {
  OtpDelivery,
  OtpSenderPort,
} from '../domain/ports/otp-sender.port';
import { InfobipSmsError } from '../infrastructure/otp/infobip-sms.policy';
import { TestOtpSender } from '../infrastructure/otp/test-otp.sender';
import { hmacOtp } from '../infrastructure/otp/otp-hash';
import { MemoryOtpStore } from '../infrastructure/otp/memory-otp.store';
import { AuthSecurityLogger } from './auth-security.logger';
import { OtpService } from './otp.service';

const SECRET = 'unit-otp-hmac-secret-value-32chars!!';

function service<S extends OtpSenderPort = TestOtpSender>(
  store = new MemoryOtpStore(),
  sender: S = new TestOtpSender() as S,
  extra: Record<string, unknown> = {},
) {
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
        ...extra,
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

  it('isolates HMAC verification by audience', async () => {
    const { otp, sender } = service();
    await otp.request({
      channel: 'PHONE',
      identifier: '0550123456',
      purpose: 'AUTHENTICATE',
      ip: '1.1.1.1',
      audience: 'CUSTOMER',
    });
    await expect(
      otp.consume({
        channel: 'PHONE',
        identifier: '0550123456',
        purpose: 'AUTHENTICATE',
        code: sender.lastCode!,
        audience: 'DRIVER',
      }),
    ).rejects.toMatchObject({ code: AUTH_ERROR_CODES.AUTH_INVALID_OTP });
    await expect(
      otp.consume({
        channel: 'PHONE',
        identifier: '0550123456',
        purpose: 'AUTHENTICATE',
        code: sender.lastCode!,
        audience: 'CUSTOMER',
      }),
    ).resolves.toBe('+213550123456');
  });

  it('returns AUTH_OTP_DELIVERY_FAILED when Infobip credentials are missing', async () => {
    const store = new MemoryOtpStore();
    const sender: OtpSenderPort = {
      send: () => Promise.reject(new InfobipSmsError('not_configured')),
    };
    const { otp } = service(store, sender);
    await expect(
      otp.request({
        channel: 'PHONE',
        identifier: '0550123456',
        purpose: 'AUTHENTICATE',
        ip: '9.9.9.8',
      }),
    ).rejects.toMatchObject({
      code: AUTH_ERROR_CODES.AUTH_OTP_DELIVERY_FAILED,
      httpStatus: 503,
    });
    expect(store.challenges.size).toBe(0);
    await expect(
      otp.consume({
        channel: 'PHONE',
        identifier: '0550123456',
        purpose: 'AUTHENTICATE',
        code: '123456',
      }),
    ).rejects.toMatchObject({ code: AUTH_ERROR_CODES.AUTH_OTP_EXPIRED });
  });

  it('does not convert a programming defect into AUTH_OTP_DELIVERY_FAILED', async () => {
    const store = new MemoryOtpStore();
    const sender: OtpSenderPort = {
      send: () => Promise.reject(new TypeError('unexpected sender bug')),
    };
    const { otp } = service(store, sender);
    await expect(
      otp.request({
        channel: 'PHONE',
        identifier: '0550123456',
        purpose: 'AUTHENTICATE',
        ip: '9.9.9.7',
      }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(store.challenges.size).toBe(0);
  });

  it('deletes a challenge on definite Infobip failure and keeps cooldown', async () => {
    const store = new MemoryOtpStore();
    const sender: OtpSenderPort = {
      send: () => Promise.reject(new InfobipSmsError('rejected', 200, 'REJECTED')),
    };
    const { otp } = service(store, sender);
    await expect(
      otp.request({
        channel: 'PHONE',
        identifier: '0550123456',
        purpose: 'AUTHENTICATE',
        ip: '9.9.9.9',
      }),
    ).rejects.toMatchObject({ code: AUTH_ERROR_CODES.AUTH_OTP_DELIVERY_FAILED });
    expect(store.challenges.size).toBe(0);
    await expect(
      otp.request({
        channel: 'PHONE',
        identifier: '0550123456',
        purpose: 'AUTHENTICATE',
        ip: '9.9.9.9',
      }),
    ).rejects.toMatchObject({ code: AUTH_ERROR_CODES.AUTH_RATE_LIMITED });
  });

  it('keeps the challenge after an uncertain timeout and does not resend', async () => {
    let sends = 0;
    const store = new MemoryOtpStore();
    const sender: OtpSenderPort = {
      send: (delivery: OtpDelivery) => {
        sends += 1;
        (sender as { lastCode?: string }).lastCode = delivery.code;
        return Promise.reject(new InfobipSmsError('uncertain'));
      },
    };
    const { otp } = service(store, sender);
    await otp.request({
      channel: 'PHONE',
      identifier: '0550123456',
      purpose: 'AUTHENTICATE',
      ip: '4.4.4.4',
    });
    expect(sends).toBe(1);
    expect(store.challenges.size).toBe(1);
    const code = (sender as { lastCode?: string }).lastCode!;
    await expect(
      otp.consume({
        channel: 'PHONE',
        identifier: '0550123456',
        purpose: 'AUTHENTICATE',
        code,
      }),
    ).resolves.toBe('+213550123456');
  });

  it('does not let an older send failure delete a newer challenge', async () => {
    const store = new MemoryOtpStore();
    const deferred: Array<{
      delivery: OtpDelivery;
      resolve: () => void;
      reject: (error: unknown) => void;
    }> = [];
    const sender: OtpSenderPort = {
      send: (delivery) =>
        new Promise((resolve, reject) => {
          deferred.push({
            delivery,
            resolve: () => resolve(),
            reject,
          });
        }),
    };
    const { otp } = service(store, sender, {
      'auth.otpResendCooldownSeconds': 0,
    });
    const first = otp.request({
      channel: 'PHONE',
      identifier: '0550123456',
      purpose: 'AUTHENTICATE',
      ip: '2.2.2.2',
    });
    for (let i = 0; i < 12 && deferred.length < 1; i += 1) {
      await Promise.resolve();
    }
    expect(deferred).toHaveLength(1);
    const second = otp.request({
      channel: 'PHONE',
      identifier: '0550123456',
      purpose: 'AUTHENTICATE',
      ip: '2.2.2.2',
    });
    for (let i = 0; i < 12 && deferred.length < 2; i += 1) {
      await Promise.resolve();
    }
    expect(deferred).toHaveLength(2);
    deferred[0].reject(new InfobipSmsError('rejected', 200, 'REJECTED'));
    deferred[1].resolve();
    await expect(first).rejects.toMatchObject({
      code: AUTH_ERROR_CODES.AUTH_OTP_DELIVERY_FAILED,
    });
    await second;
    expect(store.challenges.size).toBe(1);
    await expect(
      otp.consume({
        channel: 'PHONE',
        identifier: '0550123456',
        purpose: 'AUTHENTICATE',
        code: deferred[1].delivery.code,
      }),
    ).resolves.toBe('+213550123456');
  });
});
