import { AppError } from '../../../common/errors/app.error';

export const CHECKOUT_ERROR_CODES = {
  CHECKOUT_CART_REQUIRED: 'CHECKOUT_CART_REQUIRED',
  CHECKOUT_CART_NOT_READY: 'CHECKOUT_CART_NOT_READY',
  CHECKOUT_ADDRESS_NOT_FOUND: 'CHECKOUT_ADDRESS_NOT_FOUND',
  CHECKOUT_ADDRESS_COORDINATES_REQUIRED:
    'CHECKOUT_ADDRESS_COORDINATES_REQUIRED',
  CHECKOUT_ADDRESS_OUTSIDE_ZONE: 'CHECKOUT_ADDRESS_OUTSIDE_ZONE',
  CHECKOUT_DELIVERY_ZONE_AMBIGUOUS: 'CHECKOUT_DELIVERY_ZONE_AMBIGUOUS',
  CHECKOUT_PRICING_RULE_NOT_FOUND: 'CHECKOUT_PRICING_RULE_NOT_FOUND',
  CHECKOUT_PRICING_CONFIGURATION_INVALID:
    'CHECKOUT_PRICING_CONFIGURATION_INVALID',
  CHECKOUT_MERCHANT_NOT_OPERATIONAL: 'CHECKOUT_MERCHANT_NOT_OPERATIONAL',
  CHECKOUT_BRANCH_NOT_OPERATIONAL: 'CHECKOUT_BRANCH_NOT_OPERATIONAL',
} as const;

export type CheckoutErrorCode =
  (typeof CHECKOUT_ERROR_CODES)[keyof typeof CHECKOUT_ERROR_CODES];

export class CheckoutError extends AppError {
  constructor(code: CheckoutErrorCode, message: string, httpStatus: number) {
    super(code, message, httpStatus);
    this.name = 'CheckoutError';
  }

  declare readonly code: CheckoutErrorCode;
}

export function checkoutCartRequired(): CheckoutError {
  return new CheckoutError(
    CHECKOUT_ERROR_CODES.CHECKOUT_CART_REQUIRED,
    'An Active Cart with at least one item is required',
    409,
  );
}

export function checkoutCartNotReady(): CheckoutError {
  return new CheckoutError(
    CHECKOUT_ERROR_CODES.CHECKOUT_CART_NOT_READY,
    'Cart is not ready for Checkout',
    409,
  );
}

export function checkoutAddressNotFound(): CheckoutError {
  return new CheckoutError(
    CHECKOUT_ERROR_CODES.CHECKOUT_ADDRESS_NOT_FOUND,
    'Address was not found',
    404,
  );
}

export function checkoutAddressCoordinatesRequired(): CheckoutError {
  return new CheckoutError(
    CHECKOUT_ERROR_CODES.CHECKOUT_ADDRESS_COORDINATES_REQUIRED,
    'Address coordinates are required for Checkout',
    400,
  );
}

export function checkoutAddressOutsideZone(): CheckoutError {
  return new CheckoutError(
    CHECKOUT_ERROR_CODES.CHECKOUT_ADDRESS_OUTSIDE_ZONE,
    'Address is outside all active Delivery Zones',
    409,
  );
}

export function checkoutDeliveryZoneAmbiguous(): CheckoutError {
  return new CheckoutError(
    CHECKOUT_ERROR_CODES.CHECKOUT_DELIVERY_ZONE_AMBIGUOUS,
    'Address is covered by more than one active Delivery Zone',
    409,
  );
}

export function checkoutPricingRuleNotFound(): CheckoutError {
  return new CheckoutError(
    CHECKOUT_ERROR_CODES.CHECKOUT_PRICING_RULE_NOT_FOUND,
    'No applicable Delivery Pricing Rule was found',
    409,
  );
}

export function checkoutPricingConfigurationInvalid(): CheckoutError {
  return new CheckoutError(
    CHECKOUT_ERROR_CODES.CHECKOUT_PRICING_CONFIGURATION_INVALID,
    'Delivery Pricing Rule configuration is invalid',
    409,
  );
}

export function checkoutMerchantNotOperational(): CheckoutError {
  return new CheckoutError(
    CHECKOUT_ERROR_CODES.CHECKOUT_MERCHANT_NOT_OPERATIONAL,
    'Merchant is not operational for Checkout',
    409,
  );
}

export function checkoutBranchNotOperational(): CheckoutError {
  return new CheckoutError(
    CHECKOUT_ERROR_CODES.CHECKOUT_BRANCH_NOT_OPERATIONAL,
    'Branch is not operational for Checkout',
    409,
  );
}
