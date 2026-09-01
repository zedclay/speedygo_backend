import { createHash } from 'node:crypto';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { authInvalidIdentifier } from './auth.errors';
import type { AuthChannel } from './auth.types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 255) {
    throw authInvalidIdentifier('Invalid email');
  }
  return email;
}

export function normalizePhone(raw: string, defaultCountry: string): string {
  const parsed = parsePhoneNumberFromString(raw.trim(), defaultCountry as 'DZ');
  if (!parsed || !parsed.isValid()) {
    throw authInvalidIdentifier('Invalid phone number');
  }
  return parsed.number;
}

export function normalizeIdentifier(
  channel: AuthChannel,
  raw: string,
  defaultCountry: string,
): string {
  return channel === 'PHONE'
    ? normalizePhone(raw, defaultCountry)
    : normalizeEmail(raw);
}

export function identifierHash(normalizedIdentifier: string): string {
  return createHash('sha256')
    .update(normalizedIdentifier, 'utf8')
    .digest('hex');
}
