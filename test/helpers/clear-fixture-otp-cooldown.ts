import {
  identifierHash,
  normalizeIdentifier,
} from '../../src/modules/auth/domain/identity';
import type {
  AuthChannel,
  OtpPurpose,
} from '../../src/modules/auth/domain/auth.types';

const E2E_AUTH_PREFIX = 'auth:test:';

type RedisDelClient = {
  getClient: () => { del: (...keys: string[]) => Promise<unknown> };
};

/**
 * Deletes only this identifier's OTP resend-cooldown key on E2E Redis
 * (prefix auth:test:, isolated DB15). Does not scan or delete other
 * fixtures' challenge, hourly, or IP rate-limit keys.
 */
export async function clearFixtureOtpResendCooldown(
  redis: RedisDelClient,
  input: {
    identifier: string;
    channel: AuthChannel;
    purpose?: OtpPurpose;
    defaultCountry?: string;
  },
): Promise<void> {
  const purpose = input.purpose ?? 'AUTHENTICATE';
  const normalized = normalizeIdentifier(
    input.channel,
    input.identifier,
    input.defaultCountry ?? 'DZ',
  );
  const hash = identifierHash(normalized);
  const cooldownKey = `${E2E_AUTH_PREFIX}otp:cd:${purpose}:${input.channel}:${hash}`;
  await redis.getClient().del(cooldownKey);
}
