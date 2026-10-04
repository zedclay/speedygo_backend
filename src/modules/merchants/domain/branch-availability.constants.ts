export const AVAILABILITY_MODES = [
  'FOLLOW_SCHEDULE',
  'FORCE_CLOSED',
  'TEMPORARY_CLOSED',
] as const;

export type AvailabilityMode = (typeof AVAILABILITY_MODES)[number];

export const AVAILABILITY_REASON_CODES = [
  'PEAK_KITCHEN',
  'TECHNICAL',
  'OUT_OF_STOCK',
  'LUNCH_BREAK',
  'OTHER',
] as const;

export type AvailabilityReasonCode = (typeof AVAILABILITY_REASON_CODES)[number];

export const AVAILABILITY_CUSTOMER_MESSAGE_MAX = 500;

export function isAvailabilityMode(value: string): value is AvailabilityMode {
  return (AVAILABILITY_MODES as readonly string[]).includes(value);
}

export function isAvailabilityReasonCode(
  value: string,
): value is AvailabilityReasonCode {
  return (AVAILABILITY_REASON_CODES as readonly string[]).includes(value);
}
