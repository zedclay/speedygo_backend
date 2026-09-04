import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DELIVERY_EVENT_COMPLETED } from '../../delivery/domain/driver-delivery.policy';
import {
  DELIVERY_EVENT_DRIVER_ASSIGNED,
  isOfferExpired,
  isOpenOffer,
} from '../../matching/domain/matching.policy';
import {
  ORDER_STATUS_EVENT_MERCHANT_ACCEPTED,
  ORDER_STATUS_EVENT_MERCHANT_REJECTED,
  ORDER_STATUS_EVENT_ORDER_READY,
} from '../../orders/domain/order.policy';
import {
  NOTIFICATION_TYPE_DELIVERY_COMPLETED,
  NOTIFICATION_TYPE_DRIVER_ASSIGNED,
  NOTIFICATION_TYPE_ORDER_ACCEPTED,
  NOTIFICATION_TYPE_ORDER_READY,
  NOTIFICATION_TYPE_ORDER_REJECTED,
} from '../domain/notification.types';
import { NotificationRecoveryRepository } from '../infrastructure/notification-recovery.repository';
import { NotificationService } from './notification.service';

export type NotificationRecoveryResult = {
  merchantOrders: number;
  orderAccepted: number;
  orderRejected: number;
  orderReady: number;
  driverAssigned: number;
  deliveryCompleted: number;
  payments: number;
  refunds: number;
  settlements: number;
  earnings: number;
  matchOffers: number;
  matchOffersSkippedStale: number;
};

@Injectable()
export class NotificationRecoveryService {
  private readonly logger = new Logger(NotificationRecoveryService.name);

  constructor(
    private readonly recoveryRows: NotificationRecoveryRepository,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Bounded repair for commit→emit gaps.
   * Reads authoritative sources only; never mutates business aggregates.
   * Uses the same notify* / emitLogical path as normal post-commit emit.
   */
  async recover(): Promise<NotificationRecoveryResult> {
    const batch = this.config.get<number>(
      'notifications.recoveryBatchSize',
      50,
    );
    const lookbackMs = this.config.get<number>(
      'notifications.recoveryLookbackMs',
      86_400_000,
    );
    const offerTimeoutMs = this.config.get<number>(
      'matching.offerTimeoutMs',
      30_000,
    );
    const lookbackIso = new Date(Date.now() - lookbackMs).toISOString();
    const offerSinceIso = new Date(Date.now() - offerTimeoutMs).toISOString();

    const result: NotificationRecoveryResult = {
      merchantOrders: 0,
      orderAccepted: 0,
      orderRejected: 0,
      orderReady: 0,
      driverAssigned: 0,
      deliveryCompleted: 0,
      payments: 0,
      refunds: 0,
      settlements: 0,
      earnings: 0,
      matchOffers: 0,
      matchOffersSkippedStale: 0,
    };

    for (const row of await this.recoveryRows.listRecentOrdersForMerchantNotify(
      {
        lookbackIso,
        limit: batch,
      },
    )) {
      await this.notifications.notifyMerchantOrderCreated({
        orderId: row.orderId,
      });
      result.merchantOrders += 1;
    }

    for (const row of await this.recoveryRows.listMissingCustomerOrderEvents({
      eventType: ORDER_STATUS_EVENT_MERCHANT_ACCEPTED,
      notificationType: NOTIFICATION_TYPE_ORDER_ACCEPTED,
      lookbackIso,
      limit: batch,
    })) {
      await this.notifications.notifyOrderAccepted(row);
      result.orderAccepted += 1;
    }

    for (const row of await this.recoveryRows.listMissingCustomerOrderEvents({
      eventType: ORDER_STATUS_EVENT_MERCHANT_REJECTED,
      notificationType: NOTIFICATION_TYPE_ORDER_REJECTED,
      lookbackIso,
      limit: batch,
    })) {
      await this.notifications.notifyOrderRejected(row);
      result.orderRejected += 1;
    }

    for (const row of await this.recoveryRows.listMissingCustomerOrderEvents({
      eventType: ORDER_STATUS_EVENT_ORDER_READY,
      notificationType: NOTIFICATION_TYPE_ORDER_READY,
      lookbackIso,
      limit: batch,
    })) {
      await this.notifications.notifyOrderReady(row);
      result.orderReady += 1;
    }

    for (const row of await this.recoveryRows.listMissingDeliveryEvents({
      eventType: DELIVERY_EVENT_DRIVER_ASSIGNED,
      notificationType: NOTIFICATION_TYPE_DRIVER_ASSIGNED,
      lookbackIso,
      limit: batch,
    })) {
      await this.notifications.notifyDriverAssigned(row);
      result.driverAssigned += 1;
    }

    for (const row of await this.recoveryRows.listMissingDeliveryEvents({
      eventType: DELIVERY_EVENT_COMPLETED,
      notificationType: NOTIFICATION_TYPE_DELIVERY_COMPLETED,
      lookbackIso,
      limit: batch,
    })) {
      await this.notifications.notifyDeliveryCompleted(row);
      result.deliveryCompleted += 1;
    }

    for (const row of await this.recoveryRows.listMissingPaymentSucceeded({
      lookbackIso,
      limit: batch,
    })) {
      await this.notifications.notifyPaymentSucceeded({
        paymentId: row.paymentId,
      });
      result.payments += 1;
    }

    for (const row of await this.recoveryRows.listMissingRefundRefunded({
      lookbackIso,
      limit: batch,
    })) {
      await this.notifications.notifyRefundRefunded({
        refundId: row.refundId,
      });
      result.refunds += 1;
    }

    for (const row of await this.recoveryRows.listRecentFinalizedSettlements({
      lookbackIso,
      limit: batch,
    })) {
      await this.notifications.notifySettlementFinalized({
        settlementId: row.settlementId,
        merchantId: row.merchantId,
      });
      result.settlements += 1;
    }

    for (const row of await this.recoveryRows.listMissingDriverEarnings({
      lookbackIso,
      limit: batch,
    })) {
      await this.notifications.notifyDriverEarningCreated({
        earningId: row.earningId,
        driverId: row.driverId,
      });
      result.earnings += 1;
    }

    for (const row of await this.recoveryRows.listOpenMatchOffers({
      offeredSinceIso: offerSinceIso,
      limit: batch,
    })) {
      if (
        !isOpenOffer(row.status, row.releasedAt) ||
        isOfferExpired(row.assignedAt, offerTimeoutMs)
      ) {
        result.matchOffersSkippedStale += 1;
        continue;
      }
      await this.notifications.notifyMatchOffer({
        assignmentId: row.assignmentId,
        driverId: row.driverId,
      });
      result.matchOffers += 1;
    }

    const total =
      result.merchantOrders +
      result.orderAccepted +
      result.orderRejected +
      result.orderReady +
      result.driverAssigned +
      result.deliveryCompleted +
      result.payments +
      result.refunds +
      result.settlements +
      result.earnings +
      result.matchOffers;
    if (total > 0 || result.matchOffersSkippedStale > 0) {
      this.logger.debug(
        `Notification recovery candidates=${total} staleMatchSkipped=${result.matchOffersSkippedStale}`,
      );
    }
    return result;
  }
}
