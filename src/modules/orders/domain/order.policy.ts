import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  CATALOG_PRICE_MINOR_MAX,
  parseMinorUnits,
} from '../../catalog/domain/catalog.policy';
import { CartError } from '../../cart/domain/cart.errors';
import {
  CART_QUANTITY_MAX,
  multiplyMinorUnits,
  validateCartOptionSelections,
} from '../../cart/domain/cart.policy';
import type { CartProductSnapshot } from '../../cart/domain/cart.types';
import { CHECKOUT_ERROR_CODES } from '../../checkout/domain/checkout.errors';
import { selectApplicablePricingRules } from '../../checkout/domain/checkout.policy';
import type { CheckoutPricingRuleRecord } from '../../checkout/domain/checkout.types';
import { MerchantCommissionError } from '../../merchant-commissions/domain/merchant-commission.errors';
import {
  calculateMerchantCommissionAmountMinor,
  selectApplicableMerchantCommissionRule,
} from '../../merchant-commissions/domain/merchant-commission.policy';
import {
  orderCartNotReady,
  orderExpectedAmountsInvalid,
  orderFinancialConfigurationInvalid,
  orderPaymentMethodInvalid,
  orderPricingConfigurationInvalid,
  orderPricingRuleNotFound,
  orderReconfirmationRequired,
  type OrderReconfirmationChange,
} from './order.errors';
import type {
  OrderCommissionRuleRecord,
  OrderFinancialAmounts,
  OrderLineSnapshot,
  OrderPaymentMethod,
} from './order.types';

export const ORDER_STATUS_CREATED = 'CREATED';
export const ORDER_STATUS_CONFIRMED = 'CONFIRMED';
export const ORDER_STATUS_ACTIVE = 'ACTIVE';
export const ORDER_STATUS_COMPLETED = 'COMPLETED';
export const ORDER_STATUS_CANCELLED = 'CANCELLED';
export const ORDER_STATUS_FAILED = 'FAILED';
export const ORDER_FULFILLMENT_PENDING_ACCEPTANCE = 'PENDING_ACCEPTANCE';
export const ORDER_FULFILLMENT_ACCEPTED = 'ACCEPTED';
export const ORDER_FULFILLMENT_PREPARING = 'PREPARING';
export const ORDER_FULFILLMENT_READY = 'READY';
export const ORDER_STATUS_EVENT_CREATED = 'ORDER_CREATED';
export const ORDER_STATUS_EVENT_MERCHANT_ACCEPTED = 'MERCHANT_ACCEPTED';
export const ORDER_STATUS_EVENT_PREPARATION_STARTED = 'PREPARATION_STARTED';
export const ORDER_STATUS_EVENT_ORDER_READY = 'ORDER_READY';
export const ORDER_STATUS_EVENT_MERCHANT_REJECTED = 'MERCHANT_REJECTED';
export const ORDER_STATUS_EVENT_ACTOR_CUSTOMER = 'CUSTOMER';
export const ORDER_STATUS_EVENT_ACTOR_MERCHANT = 'MERCHANT';
export const ORDER_CURRENCY_DZD = 'DZD';
export const PAYMENT_STATUS_PENDING = 'PENDING';
export const PAYMENT_STATUS_PROCESSING = 'PROCESSING';
export const PAYMENT_STATUS_SUCCEEDED = 'SUCCEEDED';
export const PAYMENT_STATUS_FAILED = 'FAILED';
export const PAYMENT_STATUS_CANCELLED = 'CANCELLED';
export const MERCHANT_REJECTION_REASON_MAX_LENGTH = 255;
export const ORDER_PAYMENT_METHOD_COD = 'COD';
export const ORDER_PAYMENT_METHOD_ELECTRONIC = 'ELECTRONIC';
export const ORDER_PAYMENT_METHODS = [
  ORDER_PAYMENT_METHOD_COD,
  ORDER_PAYMENT_METHOD_ELECTRONIC,
] as const;

export const ORDER_LIST_DEFAULT_LIMIT = 50;
export const ORDER_LIST_MAX_LIMIT = 100;
export const ORDER_LIST_MAX_OFFSET = 10_000;

/** v1.0 promotions are unimplemented. Discount fields are 0, not unresolved. */
export const ORDER_V1_DISCOUNT_MINOR = 0;
/** Checkout v1.0 froze no extra customer taxes/fees. */
export const ORDER_V1_SERVICE_FEE_MINOR = 0;
/**
 * Upper bound for Customer-confirmed expected amounts. Live merchandise can
 * be many lines; this remains inside Number.isSafeInteger.
 */
export const ORDER_EXPECTED_MINOR_MAX =
  CATALOG_PRICE_MINOR_MAX * CART_QUANTITY_MAX * 100;

export type CustomerConfirmedAmounts = {
  expectedMerchandiseSubtotalMinor: number;
  expectedDeliveryFeeMinor: number;
  expectedCustomerTotalMinor: number;
};

export function newOrderPublicReference(): string {
  return `sgo_${createUuidV7().replaceAll('-', '')}`;
}

export function parseOrderPaymentMethod(value: string): OrderPaymentMethod {
  if (
    value === ORDER_PAYMENT_METHOD_COD ||
    value === ORDER_PAYMENT_METHOD_ELECTRONIC
  ) {
    return value;
  }
  throw orderPaymentMethodInvalid();
}

function requireExpectedMinor(value: number, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > ORDER_EXPECTED_MINOR_MAX
  ) {
    throw orderExpectedAmountsInvalid(
      `${field} must be a non-negative safe integer minor unit`,
    );
  }
  return value;
}

/**
 * Expected amounts are comparison-only Customer confirmation values.
 * They are never price authority. Internally inconsistent arithmetic is
 * rejected; the Backend does not silently normalize client totals.
 *
 * Public API: expectedCustomerTotalMinor
 * Internal snapshot: customerPayableMinor
 */
export function requireCustomerConfirmedAmounts(input: {
  expectedMerchandiseSubtotalMinor: number;
  expectedDeliveryFeeMinor: number;
  expectedCustomerTotalMinor: number;
}): CustomerConfirmedAmounts {
  const expectedMerchandiseSubtotalMinor = requireExpectedMinor(
    input.expectedMerchandiseSubtotalMinor,
    'expectedMerchandiseSubtotalMinor',
  );
  const expectedDeliveryFeeMinor = requireExpectedMinor(
    input.expectedDeliveryFeeMinor,
    'expectedDeliveryFeeMinor',
  );
  const expectedCustomerTotalMinor = requireExpectedMinor(
    input.expectedCustomerTotalMinor,
    'expectedCustomerTotalMinor',
  );
  const expectedSum = addMinorUnits(
    expectedMerchandiseSubtotalMinor,
    expectedDeliveryFeeMinor,
  );
  if (expectedCustomerTotalMinor !== expectedSum) {
    throw orderExpectedAmountsInvalid();
  }
  return {
    expectedMerchandiseSubtotalMinor,
    expectedDeliveryFeeMinor,
    expectedCustomerTotalMinor,
  };
}

/**
 * Compare live authoritative amounts against Customer-confirmed expected
 * amounts. Public expectedCustomerTotalMinor maps to customerPayableMinor.
 */
export function requireConfirmedAmountsMatch(input: {
  grossMerchandiseSubtotalMinor: number;
  deliveryFeeMinor: number;
  customerPayableMinor: number;
  expectedMerchandiseSubtotalMinor: number;
  expectedDeliveryFeeMinor: number;
  expectedCustomerTotalMinor: number;
}): void {
  const changes: OrderReconfirmationChange[] = [];
  if (
    input.grossMerchandiseSubtotalMinor !==
    input.expectedMerchandiseSubtotalMinor
  ) {
    changes.push('MERCHANDISE');
  }
  if (input.deliveryFeeMinor !== input.expectedDeliveryFeeMinor) {
    changes.push('DELIVERY_FEE');
  }
  if (input.customerPayableMinor !== input.expectedCustomerTotalMinor) {
    changes.push('CUSTOMER_TOTAL');
  }
  if (changes.length > 0) {
    throw orderReconfirmationRequired({
      changes,
      merchandiseSubtotalMinor: input.grossMerchandiseSubtotalMinor,
      deliveryFeeMinor: input.deliveryFeeMinor,
      customerTotalMinor: input.customerPayableMinor,
    });
  }
}

export function normalizeOrderListQuery(input: {
  limit?: number;
  offset?: number;
}): { limit: number; offset: number } {
  return {
    limit: input.limit ?? ORDER_LIST_DEFAULT_LIMIT,
    offset: input.offset ?? 0,
  };
}

export function addMinorUnits(left: number, right: number): number {
  if (
    !Number.isInteger(left) ||
    !Number.isInteger(right) ||
    left < 0 ||
    right < 0
  ) {
    throw orderFinancialConfigurationInvalid(
      'Money amounts must be non-negative integers',
    );
  }
  const total = left + right;
  if (!Number.isSafeInteger(total)) {
    throw orderFinancialConfigurationInvalid(
      'Money total exceeds the safe integer range',
    );
  }
  return total;
}

export function subtractMinorUnits(left: number, right: number): number {
  if (
    !Number.isInteger(left) ||
    !Number.isInteger(right) ||
    left < 0 ||
    right < 0
  ) {
    throw orderFinancialConfigurationInvalid(
      'Money amounts must be non-negative integers',
    );
  }
  const result = left - right;
  if (!Number.isInteger(result) || result < 0) {
    throw orderFinancialConfigurationInvalid(
      'Money subtraction would produce a negative amount',
    );
  }
  return result;
}

/**
 * Integer floor: (baseMinor * rateBps) / 10_000.
 * Delegates to Merchant Commission Foundation. Order creation maps
 * commission errors to ORDER_FINANCIAL_CONFIGURATION_INVALID.
 */
export function commissionAmountMinor(
  baseMinor: number,
  rateBps: number,
): number {
  try {
    return calculateMerchantCommissionAmountMinor(baseMinor, rateBps);
  } catch (error) {
    if (error instanceof MerchantCommissionError) {
      throw orderFinancialConfigurationInvalid(error.message);
    }
    throw error;
  }
}

export function selectApplicableCommissionRule(
  rules: OrderCommissionRuleRecord[],
  merchantId: string,
  instant: Date,
): OrderCommissionRuleRecord {
  try {
    const selected = selectApplicableMerchantCommissionRule(
      rules,
      merchantId,
      instant,
    );
    const match = rules.find((rule) => rule.id === selected.ruleId);
    if (!match) {
      throw orderFinancialConfigurationInvalid(
        'No applicable merchant commission rule',
      );
    }
    return match;
  } catch (error) {
    if (error instanceof MerchantCommissionError) {
      throw orderFinancialConfigurationInvalid(error.message);
    }
    throw error;
  }
}

export function selectOrderPricingRule(
  rules: CheckoutPricingRuleRecord[],
  instant: Date,
): CheckoutPricingRuleRecord {
  let applicable: CheckoutPricingRuleRecord[];
  try {
    applicable = selectApplicablePricingRules(rules, instant);
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === CHECKOUT_ERROR_CODES.CHECKOUT_PRICING_CONFIGURATION_INVALID
    ) {
      throw orderPricingConfigurationInvalid();
    }
    throw error;
  }
  if (applicable.length === 0) {
    throw orderPricingRuleNotFound();
  }
  if (applicable.length > 1) {
    throw orderPricingConfigurationInvalid();
  }
  return applicable[0];
}

export function requireLiveCartItemReady(
  snapshot: CartProductSnapshot,
  selectedOptionIds: string[],
): { additionalPriceMinor: number } {
  try {
    return validateCartOptionSelections({
      groups: snapshot.groups,
      options: snapshot.options,
      selectedOptionIds,
    });
  } catch (error) {
    if (error instanceof CartError) {
      throw orderCartNotReady();
    }
    throw error;
  }
}

export function priceOrderLine(input: {
  snapshot: CartProductSnapshot;
  quantity: number;
  selectedOptionIds: string[];
}): OrderLineSnapshot {
  const liveBase = parseMinorUnits(input.snapshot.livePriceMinor);
  if (!Number.isInteger(liveBase) || liveBase < 0) {
    throw orderCartNotReady();
  }
  const { additionalPriceMinor } = requireLiveCartItemReady(
    input.snapshot,
    input.selectedOptionIds,
  );
  const unitPriceMinor = addMinorUnits(liveBase, additionalPriceMinor);
  let lineTotalMinor: number;
  try {
    lineTotalMinor = multiplyMinorUnits(unitPriceMinor, input.quantity);
  } catch (error) {
    if (error instanceof CartError) {
      throw orderFinancialConfigurationInvalid(
        'Order line total exceeds the safe integer range',
      );
    }
    throw error;
  }
  const optionsById = new Map(
    input.snapshot.options.map((option) => [option.id, option]),
  );
  const options: OrderLineSnapshot['options'] = [];
  for (const optionId of input.selectedOptionIds) {
    const option = optionsById.get(optionId);
    if (!option || option.name.trim().length === 0) {
      throw orderCartNotReady();
    }
    options.push({
      optionNameSnapshot: option.name,
      additionalPriceMinor: option.additionalPriceMinor,
    });
  }
  return {
    productId: input.snapshot.productId,
    productNameSnapshot: input.snapshot.name,
    quantity: input.quantity,
    unitPriceMinor,
    lineTotalMinor,
    options,
  };
}

export function merchandiseSubtotalMinor(lines: OrderLineSnapshot[]): number {
  return lines.reduce(
    (sum, line) => addMinorUnits(sum, line.lineTotalMinor),
    0,
  );
}

/**
 * v1.0 snapshot with promotions unimplemented.
 * commissionBaseMinor = grossMerchandiseSubtotalMinor because discounts are 0.
 * Before Promotions Foundation enables Merchant-funded or Platform-funded
 * discounts, commission-base behavior MUST be reopened and explicitly frozen.
 * That future decision is not an Order v1.0 RBC.
 */
export function buildOrderFinancialSnapshot(input: {
  grossMerchandiseSubtotalMinor: number;
  customerDeliveryFeeMinor: number;
  driverRemunerationMinor: number;
  merchantCommissionRateBps: number;
  commissionRuleId: string;
  pricingRuleId: string;
}): OrderFinancialAmounts {
  if (
    !Number.isInteger(input.grossMerchandiseSubtotalMinor) ||
    input.grossMerchandiseSubtotalMinor < 0 ||
    input.grossMerchandiseSubtotalMinor >
      CATALOG_PRICE_MINOR_MAX * CART_QUANTITY_MAX * 100
  ) {
    throw orderFinancialConfigurationInvalid(
      'Merchandise subtotal is out of range',
    );
  }
  const merchantDiscountMinor = ORDER_V1_DISCOUNT_MINOR;
  const platformDiscountMinor = ORDER_V1_DISCOUNT_MINOR;
  const totalDiscountMinor = addMinorUnits(
    merchantDiscountMinor,
    platformDiscountMinor,
  );
  const commissionBaseMinor = input.grossMerchandiseSubtotalMinor;
  const merchantCommissionAmountMinor = commissionAmountMinor(
    commissionBaseMinor,
    input.merchantCommissionRateBps,
  );
  const merchantNetAmountMinor = subtractMinorUnits(
    subtractMinorUnits(
      input.grossMerchandiseSubtotalMinor,
      merchantDiscountMinor,
    ),
    merchantCommissionAmountMinor,
  );
  const speedyGoDeliveryShareMinor = subtractMinorUnits(
    input.customerDeliveryFeeMinor,
    input.driverRemunerationMinor,
  );
  const serviceFeeMinor = ORDER_V1_SERVICE_FEE_MINOR;
  const afterDiscounts = subtractMinorUnits(
    input.grossMerchandiseSubtotalMinor,
    totalDiscountMinor,
  );
  const customerPayableMinor = addMinorUnits(
    addMinorUnits(afterDiscounts, input.customerDeliveryFeeMinor),
    serviceFeeMinor,
  );
  return {
    currency: ORDER_CURRENCY_DZD,
    grossMerchandiseSubtotalMinor: input.grossMerchandiseSubtotalMinor,
    merchantDiscountMinor,
    platformDiscountMinor,
    totalDiscountMinor,
    commissionBaseMinor,
    merchantCommissionRateBps: input.merchantCommissionRateBps,
    merchantCommissionAmountMinor,
    merchantNetAmountMinor,
    customerDeliveryFeeMinor: input.customerDeliveryFeeMinor,
    driverRemunerationMinor: input.driverRemunerationMinor,
    speedyGoDeliveryShareMinor,
    serviceFeeMinor,
    customerPayableMinor,
    commissionRuleId: input.commissionRuleId,
    pricingRuleId: input.pricingRuleId,
  };
}

export function uniqueSortedIds(ids: string[]): string[] {
  return [...new Set(ids)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

export const ORDER_TERMINAL_STATUSES = [
  ORDER_STATUS_COMPLETED,
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_FAILED,
] as const;

export const MERCHANT_ORDER_STATUS_FILTERS = [
  ORDER_STATUS_CREATED,
  ORDER_STATUS_CONFIRMED,
  ORDER_STATUS_ACTIVE,
  ORDER_STATUS_COMPLETED,
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_FAILED,
] as const;

export const MERCHANT_FULFILLMENT_STATUS_FILTERS = [
  ORDER_FULFILLMENT_PENDING_ACCEPTANCE,
  ORDER_FULFILLMENT_ACCEPTED,
  ORDER_FULFILLMENT_PREPARING,
  ORDER_FULFILLMENT_READY,
] as const;

export type MerchantWorkflowAction =
  'ACCEPT' | 'REJECT' | 'START_PREPARATION' | 'MARK_READY';

export type MerchantTransitionDecision =
  'APPLY' | 'ALREADY_ACCEPTED' | 'NOT_REJECTABLE' | 'INVALID';

export function isTerminalOrderStatus(status: string): boolean {
  return (ORDER_TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * Merchant Order Workflow v1.0 transition inspector.
 *
 * CREATED/PENDING_ACCEPTANCE → CONFIRMED/ACCEPTED (accept)
 * CREATED/PENDING_ACCEPTANCE → CANCELLED/PENDING_ACCEPTANCE (reject)
 * CONFIRMED/ACCEPTED → ACTIVE/PREPARING (start preparation)
 * ACTIVE/PREPARING → ACTIVE/READY (mark ready)
 */
export function inspectMerchantWorkflowTransition(
  action: MerchantWorkflowAction,
  status: string,
  fulfillmentStatus: string,
): MerchantTransitionDecision {
  if (action === 'REJECT') {
    if (
      !isTerminalOrderStatus(status) &&
      status === ORDER_STATUS_CREATED &&
      fulfillmentStatus === ORDER_FULFILLMENT_PENDING_ACCEPTANCE
    ) {
      return 'APPLY';
    }
    return 'NOT_REJECTABLE';
  }
  if (isTerminalOrderStatus(status)) {
    return 'INVALID';
  }
  if (action === 'ACCEPT') {
    if (
      status === ORDER_STATUS_CREATED &&
      fulfillmentStatus === ORDER_FULFILLMENT_PENDING_ACCEPTANCE
    ) {
      return 'APPLY';
    }
    if (
      status === ORDER_STATUS_CONFIRMED &&
      fulfillmentStatus === ORDER_FULFILLMENT_ACCEPTED
    ) {
      return 'ALREADY_ACCEPTED';
    }
    return 'INVALID';
  }
  if (action === 'START_PREPARATION') {
    if (
      status === ORDER_STATUS_CONFIRMED &&
      fulfillmentStatus === ORDER_FULFILLMENT_ACCEPTED
    ) {
      return 'APPLY';
    }
    return 'INVALID';
  }
  if (
    status === ORDER_STATUS_ACTIVE &&
    fulfillmentStatus === ORDER_FULFILLMENT_PREPARING
  ) {
    return 'APPLY';
  }
  return 'INVALID';
}

export function merchantPreparationPaymentReady(
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

export function merchantWorkflowEvent(action: MerchantWorkflowAction): {
  eventType: string;
  fromStatus: string;
  toStatus: string;
} {
  if (action === 'ACCEPT') {
    return {
      eventType: ORDER_STATUS_EVENT_MERCHANT_ACCEPTED,
      fromStatus: ORDER_STATUS_CREATED,
      toStatus: ORDER_STATUS_CONFIRMED,
    };
  }
  if (action === 'REJECT') {
    return {
      eventType: ORDER_STATUS_EVENT_MERCHANT_REJECTED,
      fromStatus: ORDER_STATUS_CREATED,
      toStatus: ORDER_STATUS_CANCELLED,
    };
  }
  if (action === 'START_PREPARATION') {
    return {
      eventType: ORDER_STATUS_EVENT_PREPARATION_STARTED,
      fromStatus: ORDER_STATUS_CONFIRMED,
      toStatus: ORDER_STATUS_ACTIVE,
    };
  }
  return {
    eventType: ORDER_STATUS_EVENT_ORDER_READY,
    fromStatus: ORDER_STATUS_ACTIVE,
    toStatus: ORDER_STATUS_ACTIVE,
  };
}
