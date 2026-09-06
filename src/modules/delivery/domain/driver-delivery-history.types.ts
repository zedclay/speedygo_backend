export const DRIVER_DELIVERY_HISTORY_LIST_DEFAULT_LIMIT = 50;
export const DRIVER_DELIVERY_HISTORY_LIST_MAX_LIMIT = 100;
export const DRIVER_DELIVERY_HISTORY_LIST_MAX_OFFSET = 10_000;
export const DRIVER_DELIVERY_HISTORY_MAX_WINDOW_MS = 93 * 24 * 60 * 60 * 1000;
export const DRIVER_DELIVERY_HISTORY_CURRENCY_DZD = 'DZD';

export type DriverDeliveryHistoryListQuery = {
  limit: number;
  offset: number;
  from?: Date;
  to?: Date;
};

export type DriverDeliveryHistoryEarningView = {
  earningId: string;
  /** Persisted DriverEarning.netEarningMinor as decimal string. Not paid/payout. */
  earningAmountMinor: string;
  currency: string;
  /** v1.0: EARNED only — recognition, not transfer. */
  earningStatus: string;
  earnedAt: string;
};

export type DriverDeliveryHistoryItemView = {
  deliveryId: string;
  orderPublicReference: string;
  deliveryStatus: 'DELIVERED';
  deliveredAt: string;
  merchantName: string;
  branchName: string;
  paymentMethod: string | null;
  earning: DriverDeliveryHistoryEarningView;
};

export type DriverDeliveryHistoryDetailView = DriverDeliveryHistoryItemView & {
  pickedUpAt: string | null;
  arrivedCustomerAt: string | null;
};

export type DriverDeliveryHistoryListView = {
  items: DriverDeliveryHistoryItemView[];
  total: number;
  limit: number;
  offset: number;
};
