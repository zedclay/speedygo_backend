export const DRIVER_EARNING_STATUS_EARNED = 'EARNED';

/** v1.0 creates only EARNED (earned, unpaid). PAID belongs to future Payout. */
export const DRIVER_EARNING_STATUSES = [DRIVER_EARNING_STATUS_EARNED] as const;

export type DriverEarningStatus = (typeof DRIVER_EARNING_STATUSES)[number];

export const DRIVER_EARNING_CURRENCY_DZD = 'DZD';

export const DRIVER_EARNING_LIST_DEFAULT_LIMIT = 50;
export const DRIVER_EARNING_LIST_MAX_LIMIT = 100;

export type DriverEarningRecord = {
  id: string;
  deliveryId: string;
  driverId: string;
  baseRemunerationMinor: bigint;
  bonusMinor: bigint;
  adjustmentMinor: bigint;
  netEarningMinor: bigint;
  status: string;
  validatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DriverEarningListItemView = {
  earningId: string;
  deliveryId: string;
  orderId: string;
  amountMinor: string;
  currency: typeof DRIVER_EARNING_CURRENCY_DZD;
  status: string;
  earnedAt: string;
};

export type DriverEarningListView = {
  items: DriverEarningListItemView[];
  total: number;
  limit: number;
  offset: number;
};

export type DriverEarningSummaryView = {
  totalEarnedMinor: string;
  unpaidEarnedMinor: string;
  earningCount: number;
  currency: typeof DRIVER_EARNING_CURRENCY_DZD;
};

export type CreateDriverEarningForCompletedDeliveryInput = {
  deliveryId: string;
  orderId: string;
  driverId: string;
  /** Same authoritative completion instant as Delivery.deliveredAt. */
  occurredAt: string;
};
