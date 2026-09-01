import { AppError } from '../../../common/errors/app.error';

export const ORDER_ERROR_CODES = {
  ORDER_CART_REQUIRED: 'ORDER_CART_REQUIRED',
  ORDER_CART_NOT_READY: 'ORDER_CART_NOT_READY',
  ORDER_ADDRESS_NOT_FOUND: 'ORDER_ADDRESS_NOT_FOUND',
  ORDER_ADDRESS_COORDINATES_REQUIRED: 'ORDER_ADDRESS_COORDINATES_REQUIRED',
  ORDER_ADDRESS_OUTSIDE_ZONE: 'ORDER_ADDRESS_OUTSIDE_ZONE',
  ORDER_DELIVERY_ZONE_AMBIGUOUS: 'ORDER_DELIVERY_ZONE_AMBIGUOUS',
  ORDER_PRICING_RULE_NOT_FOUND: 'ORDER_PRICING_RULE_NOT_FOUND',
  ORDER_PRICING_CONFIGURATION_INVALID: 'ORDER_PRICING_CONFIGURATION_INVALID',
  ORDER_MERCHANT_NOT_OPERATIONAL: 'ORDER_MERCHANT_NOT_OPERATIONAL',
  ORDER_BRANCH_NOT_OPERATIONAL: 'ORDER_BRANCH_NOT_OPERATIONAL',
  ORDER_ALREADY_CREATED: 'ORDER_ALREADY_CREATED',
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  ORDER_PAYMENT_METHOD_INVALID: 'ORDER_PAYMENT_METHOD_INVALID',
  ORDER_FINANCIAL_CONFIGURATION_INVALID:
    'ORDER_FINANCIAL_CONFIGURATION_INVALID',
  ORDER_EXPECTED_AMOUNTS_INVALID: 'ORDER_EXPECTED_AMOUNTS_INVALID',
  ORDER_RECONFIRMATION_REQUIRED: 'ORDER_RECONFIRMATION_REQUIRED',
} as const;

export type OrderErrorCode =
  (typeof ORDER_ERROR_CODES)[keyof typeof ORDER_ERROR_CODES];

export class OrderError extends AppError {
  constructor(
    code: OrderErrorCode,
    message: string,
    httpStatus: number,
    details?: Record<string, unknown>,
  ) {
    super(code, message, httpStatus, details);
    this.name = 'OrderError';
  }

  declare readonly code: OrderErrorCode;
}

export function orderCartRequired(): OrderError {
  return new OrderError(
    ORDER_ERROR_CODES.ORDER_CART_REQUIRED,
    'An Active Cart with at least one item is required',
    409,
  );
}

export function orderCartNotReady(): OrderError {
  return new OrderError(
    ORDER_ERROR_CODES.ORDER_CART_NOT_READY,
    'Cart is not ready for Order creation',
    409,
  );
}

export function orderAddressNotFound(): OrderError {
  return new OrderError(
    ORDER_ERROR_CODES.ORDER_ADDRESS_NOT_FOUND,
    'Address was not found',
    404,
  );
}

export function orderAddressCoordinatesRequired(): OrderError {
  return new OrderError(
    ORDER_ERROR_CODES.ORDER_ADDRESS_COORDINATES_REQUIRED,
    'Address coordinates are required for Order creation',
    400,
  );
}

export function orderAddressOutsideZone(): OrderError {
  return new OrderError(
    ORDER_ERROR_CODES.ORDER_ADDRESS_OUTSIDE_ZONE,
    'Address is outside all active Delivery Zones',
    409,
  );
}

export function orderDeliveryZoneAmbiguous(): OrderError {
  return new OrderError(
    ORDER_ERROR_CODES.ORDER_DELIVERY_ZONE_AMBIGUOUS,
    'Address is covered by more than one active Delivery Zone',
    409,
  );
}

export function orderPricingRuleNotFound(): OrderError {
  return new OrderError(
    ORDER_ERROR_CODES.ORDER_PRICING_RULE_NOT_FOUND,
    'No applicable Delivery Pricing Rule was found',
    409,
  );
}

export function orderPricingConfigurationInvalid(): OrderError {
  return new OrderError(
    ORDER_ERROR_CODES.ORDER_PRICING_CONFIGURATION_INVALID,
    'Delivery Pricing Rule configuration is invalid',
    409,
  );
}

export function orderMerchantNotOperational(): OrderError {
  return new OrderError(
    ORDER_ERROR_CODES.ORDER_MERCHANT_NOT_OPERATIONAL,
    'Merchant is not operational for Order creation',
    409,
  );
}

export function orderBranchNotOperational(): OrderError {
  return new OrderError(
    ORDER_ERROR_CODES.ORDER_BRANCH_NOT_OPERATIONAL,
    'Branch is not operational for Order creation',
    409,
  );
}

export function orderAlreadyCreated(): OrderError {
  return new OrderError(
    ORDER_ERROR_CODES.ORDER_ALREADY_CREATED,
    'The Active Cart has already been converted into an Order',
    409,
  );
}

export function orderNotFound(): OrderError {
  return new OrderError(
    ORDER_ERROR_CODES.ORDER_NOT_FOUND,
    'Order was not found',
    404,
  );
}

export function orderPaymentMethodInvalid(): OrderError {
  return new OrderError(
    ORDER_ERROR_CODES.ORDER_PAYMENT_METHOD_INVALID,
    'Payment method is invalid',
    400,
  );
}

export function orderFinancialConfigurationInvalid(
  message = 'Order financial configuration is invalid',
): OrderError {
  return new OrderError(
    ORDER_ERROR_CODES.ORDER_FINANCIAL_CONFIGURATION_INVALID,
    message,
    409,
  );
}

export function orderExpectedAmountsInvalid(
  message = 'Expected confirmation amounts are internally inconsistent',
): OrderError {
  return new OrderError(
    ORDER_ERROR_CODES.ORDER_EXPECTED_AMOUNTS_INVALID,
    message,
    400,
  );
}

export type OrderReconfirmationChange =
  'MERCHANDISE' | 'DELIVERY_FEE' | 'CUSTOMER_TOTAL';

/**
 * Expected amounts are comparison-only. Live Backend values remain
 * authoritative. This error never persists an Order at the expected price.
 */
export function orderReconfirmationRequired(input: {
  changes: OrderReconfirmationChange[];
  merchandiseSubtotalMinor: number;
  deliveryFeeMinor: number;
  customerTotalMinor: number;
}): OrderError {
  return new OrderError(
    ORDER_ERROR_CODES.ORDER_RECONFIRMATION_REQUIRED,
    'Live Order amounts differ from the Customer-confirmed Checkout amounts',
    409,
    {
      changes: input.changes,
      current: {
        merchandiseSubtotalMinor: input.merchandiseSubtotalMinor,
        deliveryFeeMinor: input.deliveryFeeMinor,
        customerTotalMinor: input.customerTotalMinor,
      },
    },
  );
}
