import { Injectable } from '@nestjs/common';
import { isPostgresUniqueViolation } from '../../../common/errors/postgres-unique';
import { customerProfileNotFound } from '../../customers/domain/customer.errors';
import { MerchantAccessService } from '../../merchants/application/merchant-access.service';
import { MERCHANT_CAPABILITIES } from '../../merchants/domain/merchant.policy';
import {
  merchantOrderNotFound,
  orderNotFound,
} from '../../orders/domain/order.errors';
import {
  deliveryNotFound,
  deliveryOrderNotEligible,
  deliveryPaymentNotReady,
} from '../domain/delivery.errors';
import {
  isDeliveryPaymentEligible,
  isOrderEligibleForDelivery,
} from '../domain/delivery.policy';
import type {
  CustomerDeliveryView,
  DeliveryDetailView,
  MerchantDeliveryView,
} from '../domain/delivery.types';
import { DeliveryRepository } from '../infrastructure/delivery.repository';

@Injectable()
export class DeliveryService {
  constructor(
    private readonly deliveries: DeliveryRepository,
    private readonly merchantAccess: MerchantAccessService,
  ) {}

  /**
   * Internal Driver Matching orchestration primitive. Not a public HTTP create.
   * Merchant mark-ready does not call this. Repeated calls are idempotent:
   * an existing Delivery is returned without a second event or timestamp rewrite.
   */
  async createForReadyOrder(orderId: string): Promise<DeliveryDetailView> {
    try {
      await this.deliveries.runInTransaction(async (tx) => {
        const locked = await this.deliveries.lockOrder(orderId, tx);
        if (!locked) {
          throw deliveryOrderNotEligible();
        }
        const existing = await this.deliveries.findDeliveryIdByOrderId(
          orderId,
          tx,
        );
        if (existing) {
          return;
        }
        if (
          !isOrderEligibleForDelivery(locked.status, locked.fulfillmentStatus)
        ) {
          throw deliveryOrderNotEligible();
        }
        const payment = await this.deliveries.lockPayment(orderId, tx);
        if (
          !payment ||
          !isDeliveryPaymentEligible(payment.method, payment.status)
        ) {
          throw deliveryPaymentNotReady();
        }
        const hasSnapshot = await this.deliveries.findAddressSnapshot(
          orderId,
          tx,
        );
        if (!hasSnapshot) {
          throw deliveryOrderNotEligible();
        }
        await this.deliveries.insertDeliveryWithCreatedEvent(orderId, tx);
      });
    } catch (error) {
      if (!isPostgresUniqueViolation(error)) {
        throw error;
      }
    }
    const detail = await this.deliveries.findDeliveryDetail(orderId);
    if (!detail) {
      throw deliveryNotFound();
    }
    return detail;
  }

  async getCustomerDelivery(
    accountId: string,
    orderId: string,
  ): Promise<CustomerDeliveryView> {
    const profileId = await this.deliveries.findProfileIdByAccountId(accountId);
    if (!profileId) {
      throw customerProfileNotFound();
    }
    const order = await this.deliveries.findOrderRecord(orderId);
    if (!order || order.customerId !== profileId) {
      throw orderNotFound();
    }
    const detail = await this.deliveries.findDeliveryDetail(orderId);
    if (!detail) {
      throw deliveryNotFound();
    }
    const { phone: _phone, ...pickup } = detail.pickup;
    return { ...detail, pickup };
  }

  async getMerchantDelivery(
    accountId: string,
    merchantId: string,
    orderId: string,
  ): Promise<MerchantDeliveryView> {
    await this.merchantAccess.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.ORDER_READ,
    );
    const order = await this.deliveries.findOrderRecord(orderId);
    if (!order) {
      throw merchantOrderNotFound();
    }
    const owner = await this.deliveries.findBranchMerchantId(
      order.merchantBranchId,
    );
    if (owner !== merchantId) {
      throw merchantOrderNotFound();
    }
    const detail = await this.deliveries.findDeliveryDetail(orderId);
    if (!detail) {
      throw deliveryNotFound();
    }
    const { deliveryFeeMinor: _fee, ...rest } = detail;
    return rest;
  }
}
