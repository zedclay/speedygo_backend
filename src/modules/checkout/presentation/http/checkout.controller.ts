import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { CurrentPrincipal } from '../../../auth/presentation/http/decorators/current-principal.decorator';
import { CUSTOMER_ERROR_CODES } from '../../../customers/domain/customer.errors';
import { PROMOTION_ERROR_CODES } from '../../../promotions/domain/promotion.errors';
import { CheckoutService } from '../../application/checkout.service';
import { CHECKOUT_ERROR_CODES } from '../../domain/checkout.errors';
import { CheckoutPreviewResponseDto } from './dto/checkout-response.dto';
import { PreviewCheckoutDto } from './dto/checkout-write.dto';

@ApiTags('checkout')
@ApiBearerAuth()
@Controller('customer/checkout')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post('preview')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Preview Checkout for the Active Cart',
    description: [
      'Checkout Preview is stateless. It creates no Order and no Payment. It does not reserve a price, Product, Option, DeliveryZone, Driver, or Payment. Delivery Fee is live and not reserved.',
      'Requires an authenticated CustomerProfile, an Active Cart with at least one live-valid item, and an owned Address with usable coordinates.',
      'DeliveryZones are platform-wide. Coverage uses PostGIS ST_Covers (a boundary point is inside). Overlapping active zones fail closed.',
      'Delivery Fee is the flat DeliveryPricingRule.customerDeliveryFeeMinor in integer minor units. There is no distance, tax, tip, or promotion component.',
      'customerTotalMinor = merchandiseSubtotalMinor + deliveryFeeMinor. Payment method is selected later during Order creation (COD or ELECTRONIC).',
      'Optional promoCode is evaluated without redemption. Customer-safe response may include discountMinor and normalized promoCode; funding internals are never exposed.',
      'Promotions that would leave customerTotalMinor <= 0 fail closed (zero-payment Orders are unsupported).',
      'Input is addressId and optional promoCode. The Active Cart is resolved from the authenticated Customer. cartId, deliveryFee, pricingRuleId, DeliveryZone id, coordinates, paymentMethod, tax, tip, discountMinor, and funding fields are rejected.',
      'Pricing local time uses Africa/Algiers. Both-null start/end times mean all-day. A one-sided time window is invalid configuration. timeBand does not invent hidden hours.',
      'Order creation must fully revalidate Cart, Catalog, Address, zone, pricing, live merchandise prices, Delivery Fee, and Promotion inside the Order transaction.',
    ].join(' '),
  })
  @ApiOkResponse({ type: CheckoutPreviewResponseDto })
  @ApiResponse({
    status: 400,
    description: CHECKOUT_ERROR_CODES.CHECKOUT_ADDRESS_COORDINATES_REQUIRED,
  })
  @ApiResponse({
    status: 404,
    description: `${CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND} or ${CHECKOUT_ERROR_CODES.CHECKOUT_ADDRESS_NOT_FOUND} or ${PROMOTION_ERROR_CODES.PROMOTION_NOT_FOUND}`,
  })
  @ApiResponse({
    status: 409,
    description: [
      CHECKOUT_ERROR_CODES.CHECKOUT_CART_REQUIRED,
      CHECKOUT_ERROR_CODES.CHECKOUT_CART_NOT_READY,
      CHECKOUT_ERROR_CODES.CHECKOUT_ADDRESS_OUTSIDE_ZONE,
      CHECKOUT_ERROR_CODES.CHECKOUT_DELIVERY_ZONE_AMBIGUOUS,
      CHECKOUT_ERROR_CODES.CHECKOUT_PRICING_RULE_NOT_FOUND,
      CHECKOUT_ERROR_CODES.CHECKOUT_PRICING_CONFIGURATION_INVALID,
      CHECKOUT_ERROR_CODES.CHECKOUT_MERCHANT_NOT_OPERATIONAL,
      CHECKOUT_ERROR_CODES.CHECKOUT_BRANCH_NOT_OPERATIONAL,
      PROMOTION_ERROR_CODES.PROMOTION_INACTIVE,
      PROMOTION_ERROR_CODES.PROMOTION_EXPIRED,
      PROMOTION_ERROR_CODES.PROMOTION_NOT_YET_ACTIVE,
      PROMOTION_ERROR_CODES.PROMOTION_ZERO_PAYABLE_UNSUPPORTED,
    ].join(' or '),
  })
  preview(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: PreviewCheckoutDto,
  ) {
    return this.checkout.preview(principal.accountId, {
      addressId: body.addressId,
      promoCode: body.promoCode,
    });
  }
}
