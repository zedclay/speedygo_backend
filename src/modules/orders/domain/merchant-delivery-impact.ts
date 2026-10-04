/**
 * Truthful delivery-impact classification for Merchant prep-late context.
 * Never invents delivery ETA minutes. See MERCHANT_DELIVERY_IMPACT.md.
 */
export const MERCHANT_DELIVERY_IMPACT_STATES = [
  'NOT_APPLICABLE',
  'DELIVERY_TIMING_UNAVAILABLE',
  'MAY_DELAY_DRIVER_ASSIGNMENT',
  'MAY_DELAY_PICKUP',
  'DRIVER_WAITING',
  'RESOLVED',
] as const;

export type MerchantDeliveryImpactState =
  (typeof MERCHANT_DELIVERY_IMPACT_STATES)[number];

export type DeliveryImpactInput = {
  /** Order is past estimatedReadyAt while ACCEPTED/PREPARING. */
  isPreparationLate: boolean;
  fulfillmentStatus: string;
  orderStatus: string;
  /** Persisted Delivery.status, or null when no Delivery row. */
  deliveryStatus: string | null;
};

export function deriveMerchantDeliveryImpact(
  input: DeliveryImpactInput,
): MerchantDeliveryImpactState {
  const fulfillment = input.fulfillmentStatus.toUpperCase();
  const orderStatus = input.orderStatus.toUpperCase();
  const delivery = input.deliveryStatus?.toUpperCase() ?? null;

  if (
    orderStatus === 'CANCELLED' ||
    orderStatus === 'FAILED' ||
    orderStatus === 'COMPLETED'
  ) {
    return 'RESOLVED';
  }

  if (
    delivery === 'PICKED_UP' ||
    delivery === 'IN_TRANSIT' ||
    delivery === 'ARRIVED_CUSTOMER' ||
    delivery === 'DELIVERED'
  ) {
    return 'RESOLVED';
  }

  if (delivery === 'FAILED' || delivery === 'CANCELLED') {
    return 'DELIVERY_TIMING_UNAVAILABLE';
  }

  if (delivery === 'AT_PICKUP') {
    return 'DRIVER_WAITING';
  }

  if (delivery === 'DRIVER_ASSIGNED' || delivery === 'TO_PICKUP') {
    return input.isPreparationLate || fulfillment !== 'READY'
      ? 'MAY_DELAY_PICKUP'
      : 'RESOLVED';
  }

  if (delivery === 'SEARCHING_DRIVER') {
    return 'MAY_DELAY_DRIVER_ASSIGNMENT';
  }

  // No Delivery row yet (typical while ACCEPTED/PREPARING).
  if (fulfillment === 'ACCEPTED' || fulfillment === 'PREPARING') {
    return input.isPreparationLate
      ? 'MAY_DELAY_DRIVER_ASSIGNMENT'
      : 'DELIVERY_TIMING_UNAVAILABLE';
  }

  if (fulfillment === 'READY' && delivery == null) {
    return 'MAY_DELAY_DRIVER_ASSIGNMENT';
  }

  return 'DELIVERY_TIMING_UNAVAILABLE';
}

/** Whole delay minutes when late; null otherwise. Never negative. */
export function derivePreparationDelayMinutes(
  isPreparationLate: boolean,
  estimatedReadyAt: Date | string | null | undefined,
  asOf: Date,
): number | null {
  if (!isPreparationLate || estimatedReadyAt == null) return null;
  const ready =
    estimatedReadyAt instanceof Date
      ? estimatedReadyAt
      : new Date(estimatedReadyAt);
  if (Number.isNaN(ready.getTime())) return null;
  const ms = asOf.getTime() - ready.getTime();
  if (ms <= 0) return null;
  return Math.floor(ms / 60_000);
}
