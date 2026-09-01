import type {
  ConsumeOtpResult,
  OtpStorePort,
} from '../../domain/ports/otp-store.port';
import type {
  AuthChannel,
  OtpChallenge,
  OtpPurpose,
} from '../../domain/auth.types';

type Entry = { challenge: OtpChallenge; expiresAtMs: number };

/** In-memory store for unit tests. Production uses RedisOtpStore + Lua. */
export class MemoryOtpStore implements OtpStorePort {
  challenges = new Map<string, Entry>();
  cooldowns = new Map<string, number>();
  hourly = new Map<string, number>();
  ipHourly = new Map<string, number>();

  private ck(purpose: OtpPurpose, channel: AuthChannel, hash: string) {
    return `${purpose}:${channel}:${hash}`;
  }

  saveChallenge(
    purpose: OtpPurpose,
    channel: AuthChannel,
    identifierHash: string,
    challenge: OtpChallenge,
    ttlSeconds: number,
  ): Promise<void> {
    this.challenges.set(this.ck(purpose, channel, identifierHash), {
      challenge,
      expiresAtMs: Date.now() + ttlSeconds * 1000,
    });
    return Promise.resolve();
  }

  getChallenge(
    purpose: OtpPurpose,
    channel: AuthChannel,
    identifierHash: string,
  ): Promise<OtpChallenge | null> {
    const entry = this.challenges.get(
      this.ck(purpose, channel, identifierHash),
    );
    if (!entry || entry.expiresAtMs <= Date.now()) {
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.challenge);
  }

  consumeIfMatch(
    purpose: OtpPurpose,
    channel: AuthChannel,
    identifierHash: string,
    codeHash: string,
    maxAttempts: number,
  ): Promise<ConsumeOtpResult> {
    const key = this.ck(purpose, channel, identifierHash);
    const entry = this.challenges.get(key);
    if (!entry || entry.expiresAtMs <= Date.now()) {
      this.challenges.delete(key);
      return Promise.resolve({ outcome: 'missing' });
    }
    if (entry.challenge.codeHash !== codeHash) {
      entry.challenge.attemptCount += 1;
      if (entry.challenge.attemptCount >= maxAttempts) {
        this.challenges.delete(key);
        return Promise.resolve({
          outcome: 'mismatch',
          attemptsExceeded: true,
        });
      }
      return Promise.resolve({
        outcome: 'mismatch',
        attemptsExceeded: false,
      });
    }
    this.challenges.delete(key);
    return Promise.resolve({ outcome: 'ok' });
  }

  deleteChallenge(
    purpose: OtpPurpose,
    channel: AuthChannel,
    identifierHash: string,
  ): Promise<void> {
    this.challenges.delete(this.ck(purpose, channel, identifierHash));
    return Promise.resolve();
  }

  markCooldown(
    purpose: OtpPurpose,
    channel: AuthChannel,
    identifierHash: string,
    cooldownSeconds: number,
  ): Promise<void> {
    this.cooldowns.set(
      this.ck(purpose, channel, identifierHash),
      Date.now() + cooldownSeconds * 1000,
    );
    return Promise.resolve();
  }

  isCoolingDown(
    purpose: OtpPurpose,
    channel: AuthChannel,
    identifierHash: string,
  ): Promise<boolean> {
    const until = this.cooldowns.get(this.ck(purpose, channel, identifierHash));
    return Promise.resolve(Boolean(until && until > Date.now()));
  }

  incrementHourly(
    purpose: OtpPurpose,
    channel: AuthChannel,
    identifierHash: string,
  ): Promise<number> {
    const key = this.ck(purpose, channel, identifierHash);
    const next = (this.hourly.get(key) ?? 0) + 1;
    this.hourly.set(key, next);
    return Promise.resolve(next);
  }

  incrementIpHourly(ipHash: string): Promise<number> {
    const next = (this.ipHourly.get(ipHash) ?? 0) + 1;
    this.ipHourly.set(ipHash, next);
    return Promise.resolve(next);
  }
}
