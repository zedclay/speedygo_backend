import { AppError } from '../../../common/errors/app.error';

export const PROMOTION_ERROR_CODES = {
  PROMOTION_CODE_INVALID: 'PROMOTION_CODE_INVALID',
  PROMOTION_NOT_FOUND: 'PROMOTION_NOT_FOUND',
  PROMOTION_INACTIVE: 'PROMOTION_INACTIVE',
  PROMOTION_NOT_YET_ACTIVE: 'PROMOTION_NOT_YET_ACTIVE',
  PROMOTION_EXPIRED: 'PROMOTION_EXPIRED',
  PROMOTION_CONFIGURATION_INVALID: 'PROMOTION_CONFIGURATION_INVALID',
  PROMOTION_STACKING_UNSUPPORTED: 'PROMOTION_STACKING_UNSUPPORTED',
  PROMOTION_REDEMPTION_CONFLICT: 'PROMOTION_REDEMPTION_CONFLICT',
  /** Final payable would be <= 0; zero-payment Order lifecycle is unsupported. */
  PROMOTION_ZERO_PAYABLE_UNSUPPORTED: 'PROMOTION_ZERO_PAYABLE_UNSUPPORTED',
} as const;

export type PromotionErrorCode =
  (typeof PROMOTION_ERROR_CODES)[keyof typeof PROMOTION_ERROR_CODES];

export class PromotionError extends AppError {
  constructor(
    readonly code: PromotionErrorCode,
    message: string,
    httpStatus: number,
    details?: Record<string, unknown>,
  ) {
    super(code, message, httpStatus, details);
    this.name = 'PromotionError';
  }
}

export function promotionCodeInvalid(
  message = 'Promotion code is invalid',
): PromotionError {
  return new PromotionError(
    PROMOTION_ERROR_CODES.PROMOTION_CODE_INVALID,
    message,
    400,
  );
}

export function promotionNotFound(
  message = 'Promotion is not available',
): PromotionError {
  return new PromotionError(
    PROMOTION_ERROR_CODES.PROMOTION_NOT_FOUND,
    message,
    404,
  );
}

export function promotionInactive(
  message = 'Promotion is not available',
): PromotionError {
  return new PromotionError(
    PROMOTION_ERROR_CODES.PROMOTION_INACTIVE,
    message,
    409,
  );
}

export function promotionNotYetActive(
  message = 'Promotion is not yet active',
): PromotionError {
  return new PromotionError(
    PROMOTION_ERROR_CODES.PROMOTION_NOT_YET_ACTIVE,
    message,
    409,
  );
}

export function promotionExpired(
  message = 'Promotion has expired',
): PromotionError {
  return new PromotionError(
    PROMOTION_ERROR_CODES.PROMOTION_EXPIRED,
    message,
    409,
  );
}

export function promotionConfigurationInvalid(
  message = 'Promotion configuration is invalid',
): PromotionError {
  return new PromotionError(
    PROMOTION_ERROR_CODES.PROMOTION_CONFIGURATION_INVALID,
    message,
    400,
  );
}

export function promotionStackingUnsupported(
  message = 'Only one promotion may be applied per Order',
): PromotionError {
  return new PromotionError(
    PROMOTION_ERROR_CODES.PROMOTION_STACKING_UNSUPPORTED,
    message,
    409,
  );
}

export function promotionRedemptionConflict(
  message = 'Promotion could not be redeemed',
): PromotionError {
  return new PromotionError(
    PROMOTION_ERROR_CODES.PROMOTION_REDEMPTION_CONFLICT,
    message,
    409,
  );
}

export function promotionZeroPayableUnsupported(
  message = 'Promotion would leave Customer payable at zero; zero-payment Orders are not supported',
): PromotionError {
  return new PromotionError(
    PROMOTION_ERROR_CODES.PROMOTION_ZERO_PAYABLE_UNSUPPORTED,
    message,
    409,
  );
}
