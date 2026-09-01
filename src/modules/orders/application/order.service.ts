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
import {
  isBranchOperationallyActive,
  isMerchantApproved,
  isMerchantProfileComplete,
} from '../../merchants/domain/merchant.policy';
import {
  orderAddressCoordinatesRequired,
  orderAddressNotFound,
  orderAddressOutsideZone,
  orderAlreadyCreated,
  orderBranchNotOperational,
  orderCartNotReady,
  orderCartRequired,
  orderDeliveryZoneAmbiguous,
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
  selectApplicableCommissionRule,
  selectOrderPricingRule,
  uniqueSortedIds,
} from '../domain/order.policy';
import type {
  CreateOrderInput,
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
      const instant = this.clock.now();
      const pricingRule = selectOrderPricingRule(
        await this.orders.listActivePricingRules(zone.id, tx),
        instant,
      );
      const commissionRule = selectApplicableCommissionRule(
        await this.orders.listActiveCommissionRules(first.merchantId, tx),
        first.merchantId,
        instant,
      );

      const financial = buildOrderFinancialSnapshot({
        grossMerchandiseSubtotalMinor: merchandiseSubtotalMinor(lines),
        customerDeliveryFeeMinor: pricingRule.customerDeliveryFeeMinor,
        driverRemunerationMinor: pricingRule.driverRemunerationMinor,
        merchantCommissionRateBps: commissionRule.rateBps,
        commissionRuleId: commissionRule.id,
        pricingRuleId: pricingRule.id,
      });

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
    });

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
