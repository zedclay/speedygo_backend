import { AppError } from '../../../common/errors/app.error';

/** Authoritative error codes for Admin Delivery Zones + Pricing APIs v1.0. */
export const DELIVERY_PRICING_ERROR_CODES = {
  DELIVERY_ZONE_NOT_FOUND: 'DELIVERY_ZONE_NOT_FOUND',
  DELIVERY_ZONE_INVALID_GEOMETRY: 'DELIVERY_ZONE_INVALID_GEOMETRY',
  DELIVERY_ZONE_OVERLAP: 'DELIVERY_ZONE_OVERLAP',
  DELIVERY_ZONE_INTEGRITY: 'DELIVERY_ZONE_INTEGRITY',
  DELIVERY_PRICING_RULE_NOT_FOUND: 'DELIVERY_PRICING_RULE_NOT_FOUND',
  DELIVERY_PRICING_RULE_INVALID: 'DELIVERY_PRICING_RULE_INVALID',
  DELIVERY_PRICING_RULE_CONFLICT: 'DELIVERY_PRICING_RULE_CONFLICT',
  DELIVERY_PRICING_RULE_INTEGRITY: 'DELIVERY_PRICING_RULE_INTEGRITY',
} as const;

export type DeliveryPricingErrorCode =
  (typeof DELIVERY_PRICING_ERROR_CODES)[keyof typeof DELIVERY_PRICING_ERROR_CODES];

export class DeliveryPricingError extends AppError {
  constructor(
    readonly code: DeliveryPricingErrorCode,
    message: string,
    httpStatus: number,
    details?: Record<string, unknown>,
  ) {
    super(code, message, httpStatus, details);
    this.name = 'DeliveryPricingError';
  }
}

export function deliveryZoneNotFound(
  message = 'Delivery zone not found',
): DeliveryPricingError {
  return new DeliveryPricingError(
    DELIVERY_PRICING_ERROR_CODES.DELIVERY_ZONE_NOT_FOUND,
    message,
    404,
  );
}

export function deliveryZoneInvalidGeometry(
  message = 'Delivery zone geometry is invalid',
  details?: Record<string, unknown>,
): DeliveryPricingError {
  return new DeliveryPricingError(
    DELIVERY_PRICING_ERROR_CODES.DELIVERY_ZONE_INVALID_GEOMETRY,
    message,
    400,
    details,
  );
}

export function deliveryZoneOverlap(
  message = 'Delivery zone geometry overlaps an existing active zone',
): DeliveryPricingError {
  return new DeliveryPricingError(
    DELIVERY_PRICING_ERROR_CODES.DELIVERY_ZONE_OVERLAP,
    message,
    409,
  );
}

export function deliveryZoneIntegrity(
  message = 'Delivery zone database operation failed',
): DeliveryPricingError {
  return new DeliveryPricingError(
    DELIVERY_PRICING_ERROR_CODES.DELIVERY_ZONE_INTEGRITY,
    message,
    500,
  );
}

export function deliveryPricingRuleNotFound(
  message = 'Delivery pricing rule not found',
): DeliveryPricingError {
  return new DeliveryPricingError(
    DELIVERY_PRICING_ERROR_CODES.DELIVERY_PRICING_RULE_NOT_FOUND,
    message,
    404,
  );
}

export function deliveryPricingRuleInvalid(
  message = 'Delivery pricing rule is invalid',
): DeliveryPricingError {
  return new DeliveryPricingError(
    DELIVERY_PRICING_ERROR_CODES.DELIVERY_PRICING_RULE_INVALID,
    message,
    400,
  );
}

export function deliveryPricingRuleConflict(
  message = 'Delivery pricing rule activation conflict',
): DeliveryPricingError {
  return new DeliveryPricingError(
    DELIVERY_PRICING_ERROR_CODES.DELIVERY_PRICING_RULE_CONFLICT,
    message,
    409,
  );
}

export function deliveryPricingRuleIntegrity(
  message = 'Delivery pricing rule database operation failed',
): DeliveryPricingError {
  return new DeliveryPricingError(
    DELIVERY_PRICING_ERROR_CODES.DELIVERY_PRICING_RULE_INTEGRITY,
    message,
    500,
  );
}
