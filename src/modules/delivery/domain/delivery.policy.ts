import {
  ORDER_FULFILLMENT_READY,
  ORDER_PAYMENT_METHOD_COD,
  ORDER_PAYMENT_METHOD_ELECTRONIC,
  ORDER_STATUS_ACTIVE,
  PAYMENT_STATUS_CANCELLED,
  PAYMENT_STATUS_FAILED,
  PAYMENT_STATUS_SUCCEEDED,
} from '../../orders/domain/order.policy';

export const DELIVERY_STATUS_SEARCHING_DRIVER = 'SEARCHING_DRIVER';
export const DELIVERY_STATUS_DRIVER_ASSIGNED = 'DRIVER_ASSIGNED';
export const DELIVERY_STATUS_TO_PICKUP = 'TO_PICKUP';
export const DELIVERY_STATUS_AT_PICKUP = 'AT_PICKUP';
export const DELIVERY_STATUS_PICKED_UP = 'PICKED_UP';
export const DELIVERY_STATUS_IN_TRANSIT = 'IN_TRANSIT';
export const DELIVERY_STATUS_ARRIVED_CUSTOMER = 'ARRIVED_CUSTOMER';
export const DELIVERY_STATUS_DELIVERED = 'DELIVERED';
export const DELIVERY_STATUS_FAILED = 'FAILED';
export const DELIVERY_STATUS_CANCELLED = 'CANCELLED';

export const DELIVERY_STATUSES = [
  DELIVERY_STATUS_SEARCHING_DRIVER,
  DELIVERY_STATUS_DRIVER_ASSIGNED,
  DELIVERY_STATUS_TO_PICKUP,
  DELIVERY_STATUS_AT_PICKUP,
  DELIVERY_STATUS_PICKED_UP,
  DELIVERY_STATUS_IN_TRANSIT,
  DELIVERY_STATUS_ARRIVED_CUSTOMER,
  DELIVERY_STATUS_DELIVERED,
  DELIVERY_STATUS_FAILED,
  DELIVERY_STATUS_CANCELLED,
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Initial Delivery.status. SEARCHING_DRIVER is the Driver Matching start boundary. */
export const DELIVERY_INITIAL_STATUS = DELIVERY_STATUS_SEARCHING_DRIVER;

export const DELIVERY_EVENT_CREATED = 'DELIVERY_CREATED';

export const DELIVERY_TERMINAL_STATUSES = [
  DELIVERY_STATUS_DELIVERED,
  DELIVERY_STATUS_FAILED,
  DELIVERY_STATUS_CANCELLED,
] as const;

export function isOrderEligibleForDelivery(
  status: string,
  fulfillmentStatus: string,
): boolean {
  return (
    status === ORDER_STATUS_ACTIVE &&
    fulfillmentStatus === ORDER_FULFILLMENT_READY
  );
}

export function isDeliveryPaymentEligible(
  method: string,
  paymentStatus: string,
): boolean {
  if (method === ORDER_PAYMENT_METHOD_COD) {
    return (
      paymentStatus !== PAYMENT_STATUS_FAILED &&
      paymentStatus !== PAYMENT_STATUS_CANCELLED
    );
  }
  if (method === ORDER_PAYMENT_METHOD_ELECTRONIC) {
    return paymentStatus === PAYMENT_STATUS_SUCCEEDED;
  }
  return false;
}

export function isTerminalDeliveryStatus(status: string): boolean {
  return (DELIVERY_TERMINAL_STATUSES as readonly string[]).includes(status);
}
