import { Inject, Injectable } from '@nestjs/common';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import { isProductCustomerOfferable } from '../../catalog/domain/catalog.policy';
import { CartRepository } from '../../cart/infrastructure/cart.repository';
import { CART_STATUS_ACTIVE } from '../../cart/domain/cart.policy';
import type { CartProductSnapshot } from '../../cart/domain/cart.types';
import {
  CHECKOUT_CLOCK,
  type CheckoutClock,
} from '../../checkout/domain/checkout.clock';
import { customerProfileNotFound } from '../../customers/domain/customer.errors';
import { hasValidCoordinates } from '../../customers/domain/customer.types';
import { MerchantCommissionService } from '../../merchant-commissions/application/merchant-commission.service';
import { MerchantCommissionError } from '../../merchant-commissions/domain/merchant-commission.errors';
import {
  isBranchOperationallyActive,
  isMerchantApproved,
  isMerchantProfileComplete,
} from '../../merchants/domain/merchant.policy';
import { OpeningHoursService } from '../../merchants/application/opening-hours.service';
import { NotificationService } from '../../notifications/application/notification.service';
import { PromotionService } from '../../promotions/application/promotion.service';
import { requirePositiveCustomerPayableAfterPromotion } from '../../promotions/domain/promotion.policy';
import { PaidTerminalRefundService } from '../../refunds/application/paid-terminal-refund.service';
import {
  assertCustomerCancellationAllowed,
  electronicPaymentRequiresRefundIntent,
  inspectCustomerCancellation,
  normalizeCustomerCancellationReason,
  PAID_TERMINAL_REASON_CUSTOMER_CANCEL,
} from '../domain/customer-order-cancellation.policy';
import { REFUND_REQUEST_ORIGIN_CUSTOMER_CANCELLATION } from '../../refunds/domain/refund.types';
import {
  orderAddressCoordinatesRequired,
  orderAddressNotFound,
  orderAddressOutsideZone,
  orderAlreadyCreated,
  orderBranchClosed,
  orderBranchHoursNotConfigured,
  orderBranchNotOperational,
  orderCancellationCodCollected,
  orderCancellationConflict,
  orderCancellationFulfillmentActive,
  orderCartNotReady,
  orderCartRequired,
  orderDeliveryZoneAmbiguous,
  orderFinancialConfigurationInvalid,
  orderMerchantNotOperational,
  orderNotFound,
} from '../domain/order.errors';
import {
  buildOrderFinancialSnapshot,
  merchandiseSubtotalMinor,
  newOrderPublicReference,
  normalizeOrderListQuery,
  parseOrderPaymentMethod,
  priceOrderLine,
  requireConfirmedAmountsMatch,
  requireCustomerConfirmedAmounts,
  selectOrderPricingRule,
  uniqueSortedIds,
} from '../domain/order.policy';
import type {
  CreateOrderInput,
  CustomerOrderCancellationView,
  OrderDetailView,
  OrderLineSnapshot,
  OrderListView,
} from '../domain/order.types';
import { OrderRepository } from '../infrastructure/order.repository';

@Injectable()
export class OrderService {
  constructor(
    private readonly carts: CartRepository,
    private readonly orders: OrderRepository,
    private readonly commission: MerchantCommissionService,
    private readonly promotions: PromotionService,
    private readonly notifications: NotificationService,
    private readonly paidTerminalRefunds: PaidTerminalRefundService,
    private readonly openingHours: OpeningHoursService,
    @Inject(CHECKOUT_CLOCK) private readonly clock: CheckoutClock,
  ) {}

  async createOrder(
    accountId: string,
    input: CreateOrderInput,
  ): Promise<OrderDetailView> {
    const paymentMethod = parseOrderPaymentMethod(input.paymentMethod);
    const confirmed = requireCustomerConfirmedAmounts(input);
    const orderId = createUuidV7();
    const publicReference = newOrderPublicReference();

    await this.orders.runInTransaction(async (tx) => {
      const profile = await this.carts.findProfileByAccountId(accountId, tx);
      if (!profile) {
        throw customerProfileNotFound();
      }
      await this.carts.lockCustomerProfile(profile.id, tx);

      const active = await this.carts.findActiveCart(profile.id, tx);
      if (!active) {
        throw orderCartRequired();
      }
      const cart = await this.carts.lockCart(active.id, tx);
      if (!cart) {
        throw orderCartRequired();
      }
      if (cart.status !== CART_STATUS_ACTIVE) {
        throw orderAlreadyCreated();
      }

      const items = await this.carts.listItems(cart.id, tx);
      if (items.length === 0) {
        throw orderCartRequired();
      }

      const productIds = uniqueSortedIds(items.map((item) => item.productId));
      for (const productId of productIds) {
        const locked = await this.carts.lockProduct(productId, tx);
        if (!locked) {
          throw orderCartNotReady();
        }
      }

      const optionIds = uniqueSortedIds(
        items.flatMap((item) => item.optionIds),
      );
      for (const optionId of optionIds) {
        const locked = await this.orders.lockProductOption(optionId, tx);
        if (!locked) {
          throw orderCartNotReady();
        }
      }

      const snapshots = new Map<string, CartProductSnapshot>();
      for (const productId of productIds) {
        const snapshot = await this.carts.loadProductSnapshot(productId, tx);
        if (!snapshot) {
          throw orderCartNotReady();
        }
        if (snapshot.merchantBranchId !== cart.merchantBranchId) {
          throw orderCartNotReady();
        }
        snapshots.set(productId, snapshot);
      }

      const first = snapshots.get(productIds[0]);
      if (!first) {
        throw orderCartNotReady();
      }
      if (
        !isMerchantProfileComplete(first.merchantName) ||
        !isMerchantApproved(first.merchantStatus, first.merchantVerifiedAt)
      ) {
        throw orderMerchantNotOperational();
      }
      if (!isBranchOperationallyActive(first.branchOperationalStatus)) {
        throw orderBranchNotOperational();
      }

      const decisionAt = this.clock.now();
      const hours = await this.openingHours.evaluateBranch(
        cart.merchantBranchId,
        decisionAt,
      );
      if (!hours.hoursConfigured) {
        throw orderBranchHoursNotConfigured();
      }
      if (!hours.isOpenNow) {
        throw orderBranchClosed();
      }

      const lines: OrderLineSnapshot[] = [];
      for (const item of items) {
        const snapshot = snapshots.get(item.productId);
        if (
          !snapshot ||
          !isProductCustomerOfferable({
            merchantOperationalReady: snapshot.merchantOperationalReady,
            branchOperationalStatus: snapshot.branchOperationalStatus,
            categoryActive: snapshot.categoryActive,
            productAvailable: snapshot.productAvailable,
          })
        ) {
          throw orderCartNotReady();
        }
        lines.push(
          priceOrderLine({
            snapshot,
            quantity: item.quantity,
            selectedOptionIds: item.optionIds,
          }),
        );
      }

      const address = await this.orders.lockAddress(
        input.addressId,
        profile.id,
        tx,
      );
      if (!address) {
        throw orderAddressNotFound();
      }
      if (!hasValidCoordinates(address.latitude, address.longitude)) {
        throw orderAddressCoordinatesRequired();
      }

      const zones = await this.orders.findCoveringZones(
        address.latitude,
        address.longitude,
      );
      if (zones.length === 0) {
        throw orderAddressOutsideZone();
      }
      if (zones.length > 1) {
        throw orderDeliveryZoneAmbiguous();
      }
      const zone = zones[0];
      const pricingInstant = decisionAt;
      const pricingRule = selectOrderPricingRule(
        await this.orders.listActivePricingRules(zone.id, tx),
        pricingInstant,
      );
      let commissionRule;
      try {
        const commissionDecisionAt =
          await this.commission.readCommissionDecisionAt(tx);
        commissionRule = await this.commission.resolveApplicable(
          first.merchantId,
          commissionDecisionAt,
          tx,
        );
      } catch (error) {
        if (error instanceof MerchantCommissionError) {
          throw orderFinancialConfigurationInvalid(error.message);
        }
        throw error;
      }

      const gms = merchandiseSubtotalMinor(lines);
      let merchantDiscountMinor = 0;
      let platformDiscountMinor = 0;
      let promoDecision:
        | Awaited<ReturnType<PromotionService['prepareOrderRedemption']>>
        | undefined;
      if (input.promoCode !== undefined && input.promoCode !== null) {
        promoDecision = await this.promotions.prepareOrderRedemption(
          {
            code: input.promoCode,
            eligibleBaseMinor: gms,
            decisionAt: pricingInstant,
            orderId,
          },
          tx,
        );
        merchantDiscountMinor = promoDecision.merchantDiscountMinor;
        platformDiscountMinor = promoDecision.platformDiscountMinor;
      }

      const financial = buildOrderFinancialSnapshot({
        grossMerchandiseSubtotalMinor: gms,
        customerDeliveryFeeMinor: pricingRule.customerDeliveryFeeMinor,
        driverRemunerationMinor: pricingRule.driverRemunerationMinor,
        merchantCommissionRateBps: commissionRule.rateBps,
        commissionRuleId: commissionRule.ruleId,
        pricingRuleId: pricingRule.id,
        merchantDiscountMinor,
        platformDiscountMinor,
      });

      if (promoDecision) {
        requirePositiveCustomerPayableAfterPromotion({
          merchandiseSubtotalMinor: financial.grossMerchandiseSubtotalMinor,
          discountAmountMinor: financial.totalDiscountMinor,
          deliveryFeeMinor: financial.customerDeliveryFeeMinor,
          serviceFeeMinor: financial.serviceFeeMinor,
        });
      }

      requireConfirmedAmountsMatch({
        grossMerchandiseSubtotalMinor: financial.grossMerchandiseSubtotalMinor,
        deliveryFeeMinor: financial.customerDeliveryFeeMinor,
        customerPayableMinor: financial.customerPayableMinor,
        expectedMerchandiseSubtotalMinor:
          confirmed.expectedMerchandiseSubtotalMinor,
        expectedDeliveryFeeMinor: confirmed.expectedDeliveryFeeMinor,
        expectedCustomerTotalMinor: confirmed.expectedCustomerTotalMinor,
      });

      await this.orders.persistCreatedOrder(
        {
          orderId,
          publicReference,
          customerId: profile.id,
          accountId,
          merchantBranchId: cart.merchantBranchId,
          deliveryZoneId: zone.id,
          cartId: cart.id,
          paymentMethod,
          address,
          lines,
          financial,
        },
        tx,
      );

      if (promoDecision) {
        await this.promotions.commitOrderRedemption(
          {
            decision: promoDecision,
            customerId: profile.id,
            orderId,
            decisionAt: pricingInstant,
          },
          tx,
        );
      }
    });

    await this.notifications.notifyMerchantOrderCreated({ orderId });
    return this.getOrder(accountId, orderId);
  }

  async listOrders(
    accountId: string,
    query: { limit?: number; offset?: number },
  ): Promise<OrderListView> {
    const profile = await this.requireProfile(accountId);
    const page = normalizeOrderListQuery(query);
    const listed = await this.orders.listOwnedOrders(profile.id, page);
    return {
      items: listed.items,
      limit: page.limit,
      offset: page.offset,
      total: listed.total,
    };
  }

  async getOrder(accountId: string, orderId: string): Promise<OrderDetailView> {
    const profile = await this.requireProfile(accountId);
    const detail = await this.orders.findOwnedOrderDetail(profile.id, orderId);
    if (!detail) {
      throw orderNotFound();
    }
    return detail;
  }

  /**
   * Customer self-cancellation while awaiting Merchant acceptance.
   * Paid electronic success couples a durable Refund intent atomically.
   * Refund intent ≠ money returned.
   */
  async cancelOrder(
    accountId: string,
    orderId: string,
    reasonRaw?: string,
  ): Promise<CustomerOrderCancellationView> {
    const reason = normalizeCustomerCancellationReason(reasonRaw);
    let result!: CustomerOrderCancellationView;
    let customerId = '';
    let publicReference = '';

    await this.orders.runInTransaction(async (tx) => {
      const profile = await this.carts.findProfileByAccountId(accountId, tx);
      if (!profile) {
        throw customerProfileNotFound();
      }
      customerId = profile.id;
      const locked = await this.orders.lockOrder(orderId, tx);
      if (!locked || locked.customerId !== profile.id) {
        throw orderNotFound();
      }
      publicReference = locked.publicReference;

      const decision = inspectCustomerCancellation(
        locked.status,
        locked.fulfillmentStatus,
      );
      assertCustomerCancellationAllowed(decision);

      const blocker = await this.orders.findCustomerCancellationBlocker(
        orderId,
        tx,
      );
      if (blocker === 'DELIVERY') {
        throw orderCancellationFulfillmentActive();
      }
      if (blocker === 'COD') {
        throw orderCancellationCodCollected();
      }

      if (decision === 'IDEMPOTENT_CANCELLED') {
        const cancellation = await this.orders.findOrderCancellation(
          orderId,
          tx,
        );
        const payment = await this.orders.findPaymentByOrderId(orderId, tx);
        let refundFields = this.paidTerminalRefunds.toPublicRefundFields(null);
        if (payment && electronicPaymentRequiresRefundIntent(payment.status)) {
          const intent = await this.paidTerminalRefunds.ensureRefundIntentInTx(
            tx,
            {
              orderId,
              origin: REFUND_REQUEST_ORIGIN_CUSTOMER_CANCELLATION,
              reason: PAID_TERMINAL_REASON_CUSTOMER_CANCEL,
            },
          );
          refundFields = this.paidTerminalRefunds.toPublicRefundFields(intent);
        }
        result = {
          orderId,
          orderStatus: locked.status,
          cancellationAccepted: true,
          cancelledAt: cancellation?.cancelledAt ?? null,
          ...refundFields,
        };
        return;
      }

      const applied = await this.orders.applyCustomerCancel(
        orderId,
        accountId,
        reason,
        locked.updatedAt,
        tx,
      );
      if (applied !== 'APPLIED') {
        throw orderCancellationConflict();
      }

      const payment = await this.orders.findPaymentByOrderId(orderId, tx);
      let refundFields = this.paidTerminalRefunds.toPublicRefundFields(null);
      if (payment && electronicPaymentRequiresRefundIntent(payment.status)) {
        const intent = await this.paidTerminalRefunds.ensureRefundIntentInTx(
          tx,
          {
            orderId,
            origin: REFUND_REQUEST_ORIGIN_CUSTOMER_CANCELLATION,
            reason: PAID_TERMINAL_REASON_CUSTOMER_CANCEL,
          },
        );
        refundFields = this.paidTerminalRefunds.toPublicRefundFields(intent);
      }

      const cancellation = await this.orders.findOrderCancellation(orderId, tx);
      result = {
        orderId,
        orderStatus: 'CANCELLED',
        cancellationAccepted: true,
        cancelledAt: cancellation?.cancelledAt ?? null,
        ...refundFields,
      };
    });

    await this.notifications.notifyOrderCancelled({
      orderId: result.orderId,
      customerId,
      publicReference,
      refundRequired: result.refundRequired,
      refundStatus: result.refundStatus,
    });

    return result;
  }

  private async requireProfile(
    accountId: string,
  ): Promise<{ id: string; accountId: string }> {
    const profile = await this.carts.findProfileByAccountId(accountId);
    if (!profile) {
      throw customerProfileNotFound();
    }
    return profile;
  }
}
