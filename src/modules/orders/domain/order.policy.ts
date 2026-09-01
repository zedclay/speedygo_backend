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
import {
  isRuleEffectiveAt,
  selectApplicablePricingRules,
} from '../../checkout/domain/checkout.policy';
import type { CheckoutPricingRuleRecord } from '../../checkout/domain/checkout.types';
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
export const ORDER_FULFILLMENT_PENDING_ACCEPTANCE = 'PENDING_ACCEPTANCE';
export const ORDER_STATUS_EVENT_CREATED = 'ORDER_CREATED';
export const ORDER_STATUS_EVENT_ACTOR_CUSTOMER = 'CUSTOMER';
export const ORDER_CURRENCY_DZD = 'DZD';
export const PAYMENT_STATUS_PENDING = 'PENDING';
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
 * Example: 7% = 700 bps.
 */
export function commissionAmountMinor(
  baseMinor: number,
  rateBps: number,
): number {
  if (
    !Number.isInteger(baseMinor) ||
    !Number.isInteger(rateBps) ||
    baseMinor < 0 ||
    rateBps < 0 ||
    rateBps > 10_000
  ) {
    throw orderFinancialConfigurationInvalid(
      'Commission rate or base is invalid',
    );
  }
  const amount = (BigInt(baseMinor) * BigInt(rateBps)) / 10000n;
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw orderFinancialConfigurationInvalid(
      'Commission amount exceeds the safe integer range',
    );
  }
  return Number(amount);
}

export function selectApplicableCommissionRule(
  rules: OrderCommissionRuleRecord[],
  merchantId: string,
  instant: Date,
): OrderCommissionRuleRecord {
  const effective = rules.filter((rule) => isRuleEffectiveAt(rule, instant));
  const overrides = effective.filter(
    (rule) =>
      rule.scope === 'MERCHANT_OVERRIDE' && rule.merchantId === merchantId,
  );
  if (overrides.length > 1) {
    throw orderFinancialConfigurationInvalid(
      'Multiple applicable merchant commission overrides',
    );
  }
  if (overrides.length === 1) {
    return overrides[0];
  }
  const globals = effective.filter(
    (rule) => rule.scope === 'GLOBAL_DEFAULT' && rule.merchantId === null,
  );
  if (globals.length === 0) {
    throw orderFinancialConfigurationInvalid(
      'No applicable merchant commission rule',
    );
  }
  if (globals.length > 1) {
    throw orderFinancialConfigurationInvalid(
      'Multiple applicable global commission defaults',
    );
  }
  return globals[0];
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
