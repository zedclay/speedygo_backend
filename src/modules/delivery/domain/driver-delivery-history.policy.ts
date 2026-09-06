import { ASSIGNMENT_STATUS_RELEASED } from './driver-delivery.policy';
import {
  driverDeliveryHistoryIntegrity,
  driverDeliveryHistoryQueryInvalid,
} from './driver-delivery-history.errors';
import {
  DRIVER_DELIVERY_HISTORY_LIST_DEFAULT_LIMIT,
  DRIVER_DELIVERY_HISTORY_LIST_MAX_LIMIT,
  DRIVER_DELIVERY_HISTORY_LIST_MAX_OFFSET,
  DRIVER_DELIVERY_HISTORY_MAX_WINDOW_MS,
  type DriverDeliveryHistoryListQuery,
} from './driver-delivery-history.types';

export const DELIVERY_STATUS_DELIVERED = 'DELIVERED';

/**
 * Exact completed-history membership (frozen conjunction — all required):
 *
 * 1. Delivery.status = DELIVERED
 * 2. Delivery.deliveredAt IS NOT NULL
 * 3. Caller has DriverAssignment: status=RELEASED, acceptedAt set, releasedAt set,
 *    driverId = authenticated Driver
 * 4. DriverEarning.deliveryId = Delivery.id
 * 5. DriverEarning.driverId = authenticated Driver (= assignment.driverId)
 *
 * RELEASED alone is insufficient: a non-serving Driver may have been ACCEPTED then
 * RELEASED without completing. Only the completing Driver’s RELEASED row that
 * matches the authoritative DriverEarning qualifies.
 *
 * DriverEarning alone is insufficient without the matching RELEASED assignment.
 * OFFERED / REJECTED / EXPIRED / open ACCEPTED never qualify.
 */
export function isCompletedHistoryDelivery(delivery: {
  status: string;
  deliveredAt: string | null;
}): boolean {
  return (
    delivery.status === DELIVERY_STATUS_DELIVERED &&
    delivery.deliveredAt !== null &&
    delivery.deliveredAt.length > 0
  );
}

/**
 * Candidate RELEASED assignment shape for the authenticated Driver.
 * Still insufficient without matching DriverEarning (see isCompletedHistoryMembership).
 */
export function isCompletedHistoryServingAssignment(assignment: {
  status: string;
  acceptedAt: string | null;
  releasedAt: string | null;
  driverId: string;
  expectedDriverId: string;
}): boolean {
  if (assignment.driverId !== assignment.expectedDriverId) {
    return false;
  }
  if (!assignment.acceptedAt || !assignment.releasedAt) {
    return false;
  }
  return assignment.status === ASSIGNMENT_STATUS_RELEASED;
}

/**
 * Full membership conjunction. RELEASED without matching earning → false.
 */
export function isCompletedHistoryMembership(input: {
  delivery: { status: string; deliveredAt: string | null };
  assignment: {
    status: string;
    acceptedAt: string | null;
    releasedAt: string | null;
    driverId: string;
    deliveryId: string;
  };
  earning: {
    deliveryId: string;
    driverId: string;
  } | null;
  authenticatedDriverId: string;
}): boolean {
  if (
    !isCompletedHistoryDelivery(input.delivery) ||
    !isCompletedHistoryServingAssignment({
      ...input.assignment,
      expectedDriverId: input.authenticatedDriverId,
    })
  ) {
    return false;
  }
  if (!input.earning) {
    return false;
  }
  if (input.earning.deliveryId !== input.assignment.deliveryId) {
    return false;
  }
  if (input.earning.driverId !== input.authenticatedDriverId) {
    return false;
  }
  if (input.earning.driverId !== input.assignment.driverId) {
    return false;
  }
  return true;
}

/**
 * DriverEarning must belong to the same serving Driver and Delivery.
 * deliveryId is unique on DriverEarning — multiple rows must never be summed.
 */
export function assertHistoryEarningOwnership(input: {
  earning: {
    deliveryId: string;
    driverId: string;
    status: string;
  } | null;
  deliveryId: string;
  servingDriverId: string;
}): NonNullable<typeof input.earning> {
  if (!input.earning) {
    throw driverDeliveryHistoryIntegrity(
      'Completed Delivery is missing authoritative DriverEarning',
    );
  }
  if (input.earning.deliveryId !== input.deliveryId) {
    throw driverDeliveryHistoryIntegrity(
      'DriverEarning does not match Delivery',
    );
  }
  if (input.earning.driverId !== input.servingDriverId) {
    throw driverDeliveryHistoryIntegrity(
      'DriverEarning does not belong to the historical serving Driver',
    );
  }
  return input.earning;
}

/** Reject bare YYYY-MM-DD; require RFC3339 with timezone. */
export function parseHistoryInstant(raw: string): Date | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return null;
  }
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    return null;
  }
  return new Date(ms);
}

/**
 * Optional half-open [from, to) on deliveredAt.
 * Both required together; max window 93 days UTC.
 */
export function validateHistoryDeliveredAtWindow(
  fromRaw: string | undefined,
  toRaw: string | undefined,
): { from: Date; to: Date } | undefined {
  const hasFrom = fromRaw !== undefined && fromRaw !== null && fromRaw !== '';
  const hasTo = toRaw !== undefined && toRaw !== null && toRaw !== '';
  if (!hasFrom && !hasTo) {
    return undefined;
  }
  if (!hasFrom || !hasTo) {
    throw driverDeliveryHistoryQueryInvalid(
      'from and to must both be provided for a deliveredAt window',
    );
  }
  const from = parseHistoryInstant(String(fromRaw));
  const to = parseHistoryInstant(String(toRaw));
  if (!from || !to) {
    throw driverDeliveryHistoryQueryInvalid(
      'from/to must be RFC3339 timestamps with timezone (not bare YYYY-MM-DD)',
    );
  }
  if (!(from.getTime() < to.getTime())) {
    throw driverDeliveryHistoryQueryInvalid(
      'from must be strictly before to ([from, to) semantics)',
    );
  }
  if (to.getTime() - from.getTime() > DRIVER_DELIVERY_HISTORY_MAX_WINDOW_MS) {
    throw driverDeliveryHistoryQueryInvalid(
      'deliveredAt window must not exceed 93 days',
    );
  }
  return { from, to };
}

export function normalizeDriverDeliveryHistoryListQuery(input: {
  limit?: number;
  offset?: number;
  from?: string;
  to?: string;
}): DriverDeliveryHistoryListQuery {
  const rawLimit = input.limit ?? DRIVER_DELIVERY_HISTORY_LIST_DEFAULT_LIMIT;
  const rawOffset = input.offset ?? 0;
  if (
    !Number.isInteger(rawLimit) ||
    rawLimit < 1 ||
    rawLimit > DRIVER_DELIVERY_HISTORY_LIST_MAX_LIMIT
  ) {
    throw driverDeliveryHistoryQueryInvalid(
      `limit must be an integer between 1 and ${DRIVER_DELIVERY_HISTORY_LIST_MAX_LIMIT}`,
    );
  }
  if (
    !Number.isInteger(rawOffset) ||
    rawOffset < 0 ||
    rawOffset > DRIVER_DELIVERY_HISTORY_LIST_MAX_OFFSET
  ) {
    throw driverDeliveryHistoryQueryInvalid(
      `offset must be an integer between 0 and ${DRIVER_DELIVERY_HISTORY_LIST_MAX_OFFSET}`,
    );
  }
  const window = validateHistoryDeliveredAtWindow(input.from, input.to);
  return {
    limit: rawLimit,
    offset: rawOffset,
    ...(window ? { from: window.from, to: window.to } : {}),
  };
}

export const HISTORY_FORBIDDEN_RESPONSE_KEYS = [
  'orderId',
  'assignmentId',
  'customerId',
  'customerName',
  'customerPhone',
  'email',
  'addressText',
  'latitude',
  'longitude',
  'tracking',
  'ratingComment',
  'merchantCommission',
  'merchantNet',
  'settlement',
  'codOutstanding',
  'paidAt',
] as const;

/**
 * Privacy mapper: history never exposes Customer PII, full addressText,
 * GPS trails, Rating comments, Merchant finance, COD custody, or internal IDs.
 */
export function mapHistoryPublicFields(row: {
  deliveryId: string;
  orderPublicReference: string;
  deliveryStatus: string;
  deliveredAt: string;
  merchantName: string;
  branchName: string;
  paymentMethod: string | null;
  pickedUpAt: string | null;
  arrivedCustomerAt: string | null;
  earningId: string;
  earningAmountMinor: string;
  earningStatus: string;
  earnedAt: string;
  currency: string;
}): {
  list: {
    deliveryId: string;
    orderPublicReference: string;
    deliveryStatus: 'DELIVERED';
    deliveredAt: string;
    merchantName: string;
    branchName: string;
    paymentMethod: string | null;
    earning: {
      earningId: string;
      earningAmountMinor: string;
      currency: string;
      earningStatus: string;
      earnedAt: string;
    };
  };
  detailExtras: {
    pickedUpAt: string | null;
    arrivedCustomerAt: string | null;
  };
} {
  if (row.deliveryStatus !== DELIVERY_STATUS_DELIVERED) {
    throw driverDeliveryHistoryIntegrity('History row is not DELIVERED');
  }
  return {
    list: {
      deliveryId: row.deliveryId,
      orderPublicReference: row.orderPublicReference,
      deliveryStatus: DELIVERY_STATUS_DELIVERED,
      deliveredAt: row.deliveredAt,
      merchantName: row.merchantName,
      branchName: row.branchName,
      paymentMethod: row.paymentMethod,
      earning: {
        earningId: row.earningId,
        earningAmountMinor: row.earningAmountMinor,
        currency: row.currency,
        earningStatus: row.earningStatus,
        earnedAt: row.earnedAt,
      },
    },
    detailExtras: {
      pickedUpAt: row.pickedUpAt,
      arrivedCustomerAt: row.arrivedCustomerAt,
    },
  };
}

/** Fail closed if a forbidden key appears on a serialized history payload. */
export function assertHistoryPrivacyKeys(payload: unknown): void {
  const walk = (value: unknown, path: string): void => {
    if (value === null || value === undefined) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (typeof value !== 'object') {
      return;
    }
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (
        (HISTORY_FORBIDDEN_RESPONSE_KEYS as readonly string[]).includes(key)
      ) {
        throw driverDeliveryHistoryIntegrity(
          `History response must not expose ${key}`,
        );
      }
      walk(child, path ? `${path}.${key}` : key);
    }
  };
  walk(payload, '');
}
