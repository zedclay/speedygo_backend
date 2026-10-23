import { adminInvalidInput } from './admin.errors';

export const CUSTOMER_NOTE_CATEGORIES = [
  'GENERAL',
  'SUPPORT',
  'SECURITY',
  'PAYMENT',
] as const;

export type CustomerNoteCategory = (typeof CUSTOMER_NOTE_CATEGORIES)[number];

export const CUSTOMER_NOTE_BODY_MIN = 1;
export const CUSTOMER_NOTE_BODY_MAX = 4000;

export function parseCustomerNoteCategory(raw: string): CustomerNoteCategory {
  const code = raw.trim().toUpperCase();
  if ((CUSTOMER_NOTE_CATEGORIES as readonly string[]).includes(code)) {
    return code as CustomerNoteCategory;
  }
  throw adminInvalidInput(
    `category must be one of ${CUSTOMER_NOTE_CATEGORIES.join(', ')}`,
  );
}

export function normalizeCustomerNoteBody(raw: string): string {
  const trimmed = raw.trim();
  if (
    trimmed.length < CUSTOMER_NOTE_BODY_MIN ||
    trimmed.length > CUSTOMER_NOTE_BODY_MAX
  ) {
    throw adminInvalidInput(
      `body must be ${CUSTOMER_NOTE_BODY_MIN}–${CUSTOMER_NOTE_BODY_MAX} characters`,
    );
  }
  return trimmed;
}
