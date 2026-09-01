import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../../infrastructure/cache/redis.service';
import type {
  ConsumeOtpResult,
  OtpStorePort,
} from '../../domain/ports/otp-store.port';
import type {
  AuthChannel,
  OtpChallenge,
  OtpPurpose,
} from '../../domain/auth.types';

const CONSUME_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return {-3}
end
local data = cjson.decode(raw)
local now = tonumber(ARGV[3])
if data.expiresAtMs and now > tonumber(data.expiresAtMs) then
  redis.call('DEL', KEYS[1])
  return {-4}
end
if data.codeHash ~= ARGV[1] then
  data.attemptCount = (tonumber(data.attemptCount) or 0) + 1
  if data.attemptCount >= tonumber(ARGV[2]) then
    redis.call('DEL', KEYS[1])
    return {-2, data.attemptCount}
  end
  redis.call('SET', KEYS[1], cjson.encode(data), 'KEEPTTL')
  return {-1, data.attemptCount}
end
redis.call('DEL', KEYS[1])
return {1}
`;

@Injectable()
export class RedisOtpStore implements OtpStorePort {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  private prefix(): string {
    return this.config.get<string>('auth.redisKeyPrefix', 'auth:');
  }

  private challengeKey(
    purpose: OtpPurpose,
    channel: AuthChannel,
    hash: string,
  ): string {
    return `${this.prefix()}otp:${purpose}:${channel}:${hash}`;
  }

  private cooldownKey(
    purpose: OtpPurpose,
    channel: AuthChannel,
    hash: string,
  ): string {
    return `${this.prefix()}otp:cd:${purpose}:${channel}:${hash}`;
  }

  private hourlyKey(
    purpose: OtpPurpose,
    channel: AuthChannel,
    hash: string,
  ): string {
    return `${this.prefix()}otp:hr:${purpose}:${channel}:${hash}`;
  }

  private ipKey(ipHash: string): string {
    return `${this.prefix()}otp:ip:${ipHash}`;
  }

  async saveChallenge(
    purpose: OtpPurpose,
    channel: AuthChannel,
    identifierHash: string,
    challenge: OtpChallenge,
    ttlSeconds: number,
  ): Promise<void> {
    const payload = {
      ...challenge,
      expiresAtMs: Date.parse(challenge.expiresAt),
    };
    await this.redis
      .getClient()
      .set(
        this.challengeKey(purpose, channel, identifierHash),
        JSON.stringify(payload),
        'EX',
        ttlSeconds,
      );
  }

  async getChallenge(
    purpose: OtpPurpose,
    channel: AuthChannel,
    identifierHash: string,
  ): Promise<OtpChallenge | null> {
    const raw = await this.redis
      .getClient()
      .get(this.challengeKey(purpose, channel, identifierHash));
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as OtpChallenge;
  }

  async consumeIfMatch(
    purpose: OtpPurpose,
    channel: AuthChannel,
    identifierHash: string,
    codeHash: string,
    maxAttempts: number,
  ): Promise<ConsumeOtpResult> {
    const result = (await this.redis
      .getClient()
      .eval(
        CONSUME_LUA,
        1,
        this.challengeKey(purpose, channel, identifierHash),
        codeHash,
        String(maxAttempts),
        String(Date.now()),
      )) as number[];
    const code = result[0];
    if (code === 1) {
      return { outcome: 'ok' };
    }
    if (code === -2) {
      return { outcome: 'mismatch', attemptsExceeded: true };
    }
    if (code === -1) {
      return { outcome: 'mismatch', attemptsExceeded: false };
    }
    return { outcome: 'missing' };
  }

  async deleteChallenge(
    purpose: OtpPurpose,
    channel: AuthChannel,
    identifierHash: string,
  ): Promise<void> {
    await this.redis
      .getClient()
      .del(this.challengeKey(purpose, channel, identifierHash));
  }

  async markCooldown(
    purpose: OtpPurpose,
    channel: AuthChannel,
    identifierHash: string,
    cooldownSeconds: number,
  ): Promise<void> {
    await this.redis
      .getClient()
      .set(
        this.cooldownKey(purpose, channel, identifierHash),
        '1',
        'EX',
        cooldownSeconds,
      );
  }

  async isCoolingDown(
    purpose: OtpPurpose,
    channel: AuthChannel,
    identifierHash: string,
  ): Promise<boolean> {
    const exists = await this.redis
      .getClient()
      .exists(this.cooldownKey(purpose, channel, identifierHash));
    return exists === 1;
  }

  async incrementHourly(
    purpose: OtpPurpose,
    channel: AuthChannel,
    identifierHash: string,
  ): Promise<number> {
    const key = this.hourlyKey(purpose, channel, identifierHash);
    const client = this.redis.getClient();
    const count = await client.incr(key);
    if (count === 1) {
      await client.expire(key, 3600);
    }
    return count;
  }

  async incrementIpHourly(ipHash: string): Promise<number> {
    const key = this.ipKey(ipHash);
    const client = this.redis.getClient();
    const count = await client.incr(key);
    if (count === 1) {
      await client.expire(key, 3600);
    }
    return count;
  }
}
