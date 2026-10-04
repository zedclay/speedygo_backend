export const PREPARATION_MINUTES_MIN = 5;
export const PREPARATION_MINUTES_MAX = 120;
export const PREPARATION_ADD_MINUTES_MIN = 1;
export const PREPARATION_ADD_MINUTES_MAX = 60;
export const PREPARATION_ESTIMATE_REASON_MAX = 255;

export const PREPARATION_MINUTE_PRESETS = [15, 20, 25, 30, 45] as const;

export function isEligibleFulfillmentForPrepEstimateUpdate(
  fulfillmentStatus: string,
  orderStatus: string,
): boolean {
  if (orderStatus === 'CANCELLED' || orderStatus === 'FAILED') {
    return false;
  }
  return fulfillmentStatus === 'ACCEPTED' || fulfillmentStatus === 'PREPARING';
}

export function computeEstimatedReadyAt(
  acceptInstant: Date,
  preparationMinutes: number,
): Date {
  return new Date(acceptInstant.getTime() + preparationMinutes * 60_000);
}

export function deriveIsPreparationLate(input: {
  estimatedReadyAt: string | null | undefined;
  fulfillmentStatus: string;
  orderStatus: string;
  now?: Date;
}): boolean {
  if (!input.estimatedReadyAt) return false;
  if (
    input.orderStatus === 'CANCELLED' ||
    input.orderStatus === 'FAILED' ||
    input.orderStatus === 'COMPLETED'
  ) {
    return false;
  }
  if (
    input.fulfillmentStatus !== 'ACCEPTED' &&
    input.fulfillmentStatus !== 'PREPARING'
  ) {
    return false;
  }
  const ready = new Date(input.estimatedReadyAt);
  if (Number.isNaN(ready.getTime())) return false;
  const now = input.now ?? new Date();
  return now.getTime() > ready.getTime();
}
