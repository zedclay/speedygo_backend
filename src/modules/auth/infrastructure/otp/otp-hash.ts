import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { AuthChannel, OtpPurpose } from '../../domain/auth.types';

export function generateNumericOtp(digits = 6): string {
  const max = 10 ** digits;
  return randomInt(0, max).toString().padStart(digits, '0');
}

export function hmacOtp(params: {
  secret: string;
  identifier: string;
  purpose: OtpPurpose;
  channel: AuthChannel;
  code: string;
  audience?: string | null;
}): string {
  const audiencePart = params.audience ? `:${params.audience}` : '';
  return createHmac('sha256', params.secret)
    .update(
      `${params.purpose}:${params.channel}:${params.identifier}:${params.code}${audiencePart}`,
      'utf8',
    )
    .digest('hex');
}

export function hmacEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
