import type { AuthChannel, OtpChallenge, OtpPurpose } from '../auth.types';

export const OTP_STORE = Symbol('OTP_STORE');

export type ConsumeOtpResult =
  | { outcome: 'ok' }
  | { outcome: 'missing' }
  | { outcome: 'mismatch'; attemptsExceeded: boolean };

export interface OtpStorePort {
  saveChallenge(
    purpose: OtpPurpose,
    channel: AuthChannel,
    identifierHash: string,
    challenge: OtpChallenge,
    ttlSeconds: number,
  ): Promise<void>;
  getChallenge(
    purpose: OtpPurpose,
    channel: AuthChannel,
    identifierHash: string,
  ): Promise<OtpChallenge | null>;
  consumeIfMatch(
    purpose: OtpPurpose,
    channel: AuthChannel,
    identifierHash: string,
    codeHash: string,
    maxAttempts: number,
  ): Promise<ConsumeOtpResult>;
  deleteChallenge(
    purpose: OtpPurpose,
    channel: AuthChannel,
    identifierHash: string,
  ): Promise<void>;
  markCooldown(
    purpose: OtpPurpose,
    channel: AuthChannel,
    identifierHash: string,
    cooldownSeconds: number,
  ): Promise<void>;
  isCoolingDown(
    purpose: OtpPurpose,
    channel: AuthChannel,
    identifierHash: string,
  ): Promise<boolean>;
  incrementHourly(
    purpose: OtpPurpose,
    channel: AuthChannel,
    identifierHash: string,
  ): Promise<number>;
  incrementIpHourly(ipHash: string): Promise<number>;
}
