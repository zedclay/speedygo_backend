import { Inject, Injectable } from '@nestjs/common';
import { CartService } from '../../cart/application/cart.service';
import { customerProfileNotFound } from '../../customers/domain/customer.errors';
import { hasValidCoordinates } from '../../customers/domain/customer.types';
import {
  isBranchOperationallyActive,
  isMerchantApproved,
  isMerchantProfileComplete,
} from '../../merchants/domain/merchant.policy';
import { PromotionService } from '../../promotions/application/promotion.service';
import { CHECKOUT_CLOCK, type CheckoutClock } from '../domain/checkout.clock';
import {
  checkoutAddressCoordinatesRequired,
  checkoutAddressNotFound,
  checkoutAddressOutsideZone,
  checkoutBranchNotOperational,
  checkoutCartNotReady,
  checkoutCartRequired,
  checkoutDeliveryZoneAmbiguous,
  checkoutMerchantNotOperational,
} from '../domain/checkout.errors';
import { requirePositiveCustomerPayableAfterPromotion } from '../../promotions/domain/promotion.policy';
import {
  CHECKOUT_PRICING_TIMEZONE,
  customerTotalMinor,
  requireSinglePricingRule,
  selectApplicablePricingRules,
} from '../domain/checkout.policy';
import type {
  CheckoutPreviewInput,
  CheckoutPreviewView,
  CheckoutWarningCode,
} from '../domain/checkout.types';
import { CheckoutRepository } from '../infrastructure/checkout.repository';

@Injectable()
export class CheckoutService {
  constructor(
    private readonly carts: CartService,
    private readonly checkout: CheckoutRepository,
    private readonly promotions: PromotionService,
    @Inject(CHECKOUT_CLOCK) private readonly clock: CheckoutClock,
  ) {}

  /**
   * Live Checkout Preview. Stateless. Not a reservation. Creates no Order/Payment/redemption.
   * Delivery Fee and Catalog prices are live and not locked.
   * Optional promoCode is evaluated without consuming usage.
   */
  async preview(
    accountId: string,
    input: CheckoutPreviewInput,
  ): Promise<CheckoutPreviewView> {
    const cartState = await this.carts.getCart(accountId);
    if (
      !cartState.cartExists ||
      !cartState.cart ||
      cartState.cart.itemCount < 1
    ) {
      throw checkoutCartRequired();
    }
    const cart = cartState.cart;

    const profile = await this.checkout.findProfileByAccountId(accountId);
    if (!profile) {
      throw customerProfileNotFound();
    }

    const address = await this.checkout.findOwnedAddress(
      profile.id,
      input.addressId,
    );
    if (!address) {
      throw checkoutAddressNotFound();
    }
    if (!hasValidCoordinates(address.latitude, address.longitude)) {
      throw checkoutAddressCoordinatesRequired();
    }

    const branchMerchant = await this.checkout.findBranchMerchant(
      cart.branchId,
    );
    if (
      !branchMerchant ||
      !isMerchantProfileComplete(branchMerchant.merchantName) ||
      !isMerchantApproved(
        branchMerchant.merchantStatus,
        branchMerchant.merchantVerifiedAt,
      )
    ) {
      throw checkoutMerchantNotOperational();
    }
    if (!isBranchOperationallyActive(branchMerchant.branchOperationalStatus)) {
      throw checkoutBranchNotOperational();
    }
    if (!cart.cartReady) {
      throw checkoutCartNotReady();
    }

    const zones = await this.checkout.findCoveringZones(
      address.latitude,
      address.longitude,
    );
    if (zones.length === 0) {
      throw checkoutAddressOutsideZone();
    }
    if (zones.length > 1) {
      throw checkoutDeliveryZoneAmbiguous();
    }
    const zone = zones[0];

    const decisionAt = this.clock.now();
    const applicable = selectApplicablePricingRules(
      await this.checkout.listActivePricingRules(zone.id),
      decisionAt,
    );
    const rule = requireSinglePricingRule(applicable);
    const deliveryFeeMinor = rule.customerDeliveryFeeMinor;
    const merchandiseSubtotalMinor = cart.cartSubtotalMinor;
    const warnings: CheckoutWarningCode[] = [];
    if (
      cart.items.some(
        (item) => item.storedUnitPriceMinor !== item.unitPriceMinor,
      )
    ) {
      warnings.push('PRICE_CHANGED');
    }

    let discountMinor = 0;
    let promoCode: string | null = null;
    if (input.promoCode !== undefined && input.promoCode !== null) {
      const decision = await this.promotions.evaluateForPreview({
        code: input.promoCode,
        eligibleBaseMinor: merchandiseSubtotalMinor,
        decisionAt,
      });
      discountMinor = decision.discountAmountMinor;
      promoCode = decision.code;
      requirePositiveCustomerPayableAfterPromotion({
        merchandiseSubtotalMinor,
        discountAmountMinor: discountMinor,
        deliveryFeeMinor,
      });
    }

    return {
      checkoutReady: true,
      warnings,
      cart: {
        id: cart.id,
        branchId: cart.branchId,
        merchantId: cart.merchantId,
        itemCount: cart.itemCount,
        merchandiseSubtotalMinor,
        items: cart.items,
      },
      address: {
        id: address.id,
        label: address.label,
        addressText: address.addressText,
        latitude: address.latitude,
        longitude: address.longitude,
      },
      deliveryZone: {
        id: zone.id,
        name: zone.name,
      },
      pricing: {
        ruleId: rule.id,
        ruleName: rule.name,
        timeBand: rule.timeBand,
        timezone: CHECKOUT_PRICING_TIMEZONE,
      },
      merchandiseSubtotalMinor,
      deliveryFeeMinor,
      discountMinor,
      promoCode,
      customerTotalMinor: customerTotalMinor(
        merchandiseSubtotalMinor,
        deliveryFeeMinor,
        discountMinor,
      ),
    };
  }
}
