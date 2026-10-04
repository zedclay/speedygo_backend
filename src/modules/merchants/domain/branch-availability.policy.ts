import { availabilityInvalid } from './branch-availability.errors';
import {
  AVAILABILITY_CUSTOMER_MESSAGE_MAX,
  isAvailabilityMode,
  isAvailabilityReasonCode,
  type AvailabilityMode,
  type AvailabilityReasonCode,
} from './branch-availability.constants';

export type PutAvailabilityInput = {
  expectedVersion: number;
  mode: string;
  reasonCode?: string | null;
  customerMessage?: string | null;
  closedUntil?: string | null;
};

export type NormalizedAvailabilityPut = {
  expectedVersion: number;
  mode: AvailabilityMode;
  reasonCode: AvailabilityReasonCode | null;
  customerMessage: string | null;
  closedUntil: Date | null;
};

export function validateAndNormalizeAvailabilityPut(
  input: PutAvailabilityInput,
  now: Date,
): NormalizedAvailabilityPut {
  if (
    typeof input.expectedVersion !== 'number' ||
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 0
  ) {
    throw availabilityInvalid('expectedVersion must be an integer >= 0');
  }
  if (!isAvailabilityMode(input.mode)) {
    throw availabilityInvalid('mode is invalid');
  }
  const mode = input.mode;

  let reasonCode: AvailabilityReasonCode | null = null;
  if (input.reasonCode != null && input.reasonCode !== '') {
    if (!isAvailabilityReasonCode(input.reasonCode)) {
      throw availabilityInvalid('reasonCode is invalid');
    }
    reasonCode = input.reasonCode;
  }

  let customerMessage: string | null = null;
  if (input.customerMessage != null && input.customerMessage !== '') {
    const trimmed = input.customerMessage.trim();
    if (trimmed.length > AVAILABILITY_CUSTOMER_MESSAGE_MAX) {
      throw availabilityInvalid(
        `customerMessage must be at most ${AVAILABILITY_CUSTOMER_MESSAGE_MAX} characters`,
      );
    }
    customerMessage = trimmed.length === 0 ? null : trimmed;
  }

  let closedUntil: Date | null = null;
  if (input.closedUntil != null && input.closedUntil !== '') {
    const d = new Date(input.closedUntil);
    if (Number.isNaN(d.getTime())) {
      throw availabilityInvalid('closedUntil must be a valid RFC3339 instant');
    }
    closedUntil = d;
  }

  if (mode === 'FOLLOW_SCHEDULE') {
    if (closedUntil != null) {
      throw availabilityInvalid(
        'closedUntil must be null when mode is FOLLOW_SCHEDULE',
      );
    }
    reasonCode = null;
    customerMessage = null;
  } else if (mode === 'FORCE_CLOSED') {
    if (closedUntil != null) {
      throw availabilityInvalid(
        'closedUntil must be null when mode is FORCE_CLOSED',
      );
    }
  } else if (mode === 'TEMPORARY_CLOSED') {
    if (closedUntil == null) {
      throw availabilityInvalid(
        'closedUntil is required when mode is TEMPORARY_CLOSED',
      );
    }
    if (closedUntil.getTime() <= now.getTime()) {
      throw availabilityInvalid('closedUntil must be strictly in the future');
    }
  }

  return {
    expectedVersion: input.expectedVersion,
    mode,
    reasonCode,
    customerMessage,
    closedUntil,
  };
}
