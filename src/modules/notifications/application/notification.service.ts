import { Injectable, Logger } from '@nestjs/common';
import {
  notificationIntegrityConflict,
  notificationNotFound,
} from '../domain/notification.errors';
import {
  buildNotificationCategory,
  copyDeliveryCompleted,
  copyDriverAssigned,
  copyDriverEarningCreated,
  copyMatchOffer,
  copyMerchantOrderCreated,
  copyOrderAccepted,
  copyOrderReady,
  copyOrderRejected,
  copyPaymentSucceeded,
  copyRefundRefunded,
  copySettlementFinalized,
  normalizeNotificationListQuery,
  requireAccountId,
  requireDeviceTokenPlatform,
  requirePushToken,
  requireSourceId,
  requireTitleBody,
  toNotificationView,
} from '../domain/notification.policy';
import {
  NOTIFICATION_CHANNEL_IN_APP,
  NOTIFICATION_CHANNEL_PUSH,
  NOTIFICATION_DELIVERY_SENT,
  NOTIFICATION_DELIVERY_SKIPPED_NOT_CONFIGURED,
  NOTIFICATION_TYPE_DELIVERY_COMPLETED,
  NOTIFICATION_TYPE_DRIVER_ASSIGNED,
  NOTIFICATION_TYPE_DRIVER_EARNING_CREATED,
  NOTIFICATION_TYPE_MATCH_OFFER,
  NOTIFICATION_TYPE_MERCHANT_ORDER_CREATED,
  NOTIFICATION_TYPE_ORDER_ACCEPTED,
  NOTIFICATION_TYPE_ORDER_READY,
  NOTIFICATION_TYPE_ORDER_REJECTED,
  NOTIFICATION_TYPE_PAYMENT_SUCCEEDED,
  NOTIFICATION_TYPE_REFUND_REFUNDED,
  NOTIFICATION_TYPE_SETTLEMENT_FINALIZED,
  type DeviceTokenRecord,
  type EmitNotificationInput,
  type NotificationListView,
  type NotificationRecord,
  type NotificationView,
} from '../domain/notification.types';
import {
  NotificationRepository,
  type OrmClient,
} from '../infrastructure/notification.repository';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly notifications: NotificationRepository) {}

  /**
   * Create at-most-one logical Notification for (type, sourceId, accountId).
   * Records IN_APP delivery as SENT. Does not call external Push providers.
   * Push channel is logged as SKIPPED_NOT_CONFIGURED (no fake success).
   */
  async emitLogical(
    input: EmitNotificationInput,
    client?: OrmClient,
  ): Promise<{ notification: NotificationRecord; created: boolean }> {
    const accountId = requireAccountId(input.accountId);
    const sourceId = requireSourceId(input.sourceId);
    requireTitleBody(input.title, input.body);
    const category = buildNotificationCategory(input.type, sourceId);

    const run = async (tx: OrmClient) => {
      await this.notifications.lockLogicalNotification(
        input.type,
        sourceId,
        accountId,
        tx,
      );
      const existing = await this.notifications.findByAccountCategory(
        accountId,
        category,
        tx,
      );
      if (existing.length > 1) {
        throw notificationIntegrityConflict(
          'Multiple notifications exist for the same source/recipient/type',
        );
      }
      if (existing.length === 1) {
        return { notification: existing[0], created: false };
      }
      const notification = await this.notifications.createNotification(
        {
          accountId,
          title: input.title.trim(),
          body: input.body.trim(),
          category,
        },
        tx,
      );
      const now = new Date();
      await this.notifications.createDeliveryLog(
        {
          notificationId: notification.id,
          channel: NOTIFICATION_CHANNEL_IN_APP,
          status: NOTIFICATION_DELIVERY_SENT,
          providerReference: `in_app:${category}`,
          sentAt: now,
        },
        tx,
      );
      await this.notifications.createDeliveryLog(
        {
          notificationId: notification.id,
          channel: NOTIFICATION_CHANNEL_PUSH,
          status: NOTIFICATION_DELIVERY_SKIPPED_NOT_CONFIGURED,
          providerReference: null,
          sentAt: null,
        },
        tx,
      );
      return { notification, created: true };
    };

    if (client) {
      return run(client);
    }
    return this.notifications.runInTransaction(run);
  }

  /**
   * Never throws to callers. Business state must remain authoritative.
   */
  async emitSafe(input: EmitNotificationInput): Promise<void> {
    try {
      await this.emitLogical(input);
    } catch (error) {
      this.logger.warn(
        `notification emit failed type=${input.type} source=${input.sourceId} account=${input.accountId} err=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async notifyOrderAccepted(input: {
    orderId: string;
    customerId: string;
    publicReference: string;
  }): Promise<void> {
    const accountId =
      await this.notifications.findCustomerAccountIdByCustomerId(
        input.customerId,
      );
    if (!accountId) return;
    const copy = copyOrderAccepted(input.publicReference);
    await this.emitSafe({
      type: NOTIFICATION_TYPE_ORDER_ACCEPTED,
      sourceId: input.orderId,
      accountId,
      ...copy,
    });
  }

  async notifyOrderRejected(input: {
    orderId: string;
    customerId: string;
    publicReference: string;
  }): Promise<void> {
    const accountId =
      await this.notifications.findCustomerAccountIdByCustomerId(
        input.customerId,
      );
    if (!accountId) return;
    const copy = copyOrderRejected(input.publicReference);
    await this.emitSafe({
      type: NOTIFICATION_TYPE_ORDER_REJECTED,
      sourceId: input.orderId,
      accountId,
      ...copy,
    });
  }

  async notifyOrderReady(input: {
    orderId: string;
    customerId: string;
    publicReference: string;
  }): Promise<void> {
    const accountId =
      await this.notifications.findCustomerAccountIdByCustomerId(
        input.customerId,
      );
    if (!accountId) return;
    const copy = copyOrderReady(input.publicReference);
    await this.emitSafe({
      type: NOTIFICATION_TYPE_ORDER_READY,
      sourceId: input.orderId,
      accountId,
      ...copy,
    });
  }

  async notifyDriverAssigned(input: {
    orderId: string;
    customerId: string;
    publicReference: string;
  }): Promise<void> {
    const accountId =
      await this.notifications.findCustomerAccountIdByCustomerId(
        input.customerId,
      );
    if (!accountId) return;
    const copy = copyDriverAssigned(input.publicReference);
    await this.emitSafe({
      type: NOTIFICATION_TYPE_DRIVER_ASSIGNED,
      sourceId: input.orderId,
      accountId,
      ...copy,
    });
  }

  async notifyDeliveryCompleted(input: {
    orderId: string;
    customerId: string;
    publicReference: string;
  }): Promise<void> {
    const accountId =
      await this.notifications.findCustomerAccountIdByCustomerId(
        input.customerId,
      );
    if (!accountId) return;
    const copy = copyDeliveryCompleted(input.publicReference);
    await this.emitSafe({
      type: NOTIFICATION_TYPE_DELIVERY_COMPLETED,
      sourceId: input.orderId,
      accountId,
      ...copy,
    });
  }

  async notifyMatchOffer(input: {
    assignmentId: string;
    driverId: string;
  }): Promise<void> {
    const accountId = await this.notifications.findDriverAccountIdByDriverId(
      input.driverId,
    );
    if (!accountId) return;
    const copy = copyMatchOffer();
    await this.emitSafe({
      type: NOTIFICATION_TYPE_MATCH_OFFER,
      sourceId: input.assignmentId,
      accountId,
      ...copy,
    });
  }

  async notifyPaymentSucceeded(input: {
    paymentId: string;
    customerId?: string;
    publicReference?: string;
  }): Promise<void> {
    let customerId = input.customerId;
    let publicReference = input.publicReference;
    if (!customerId || !publicReference) {
      const ctx = await this.notifications.findPaymentNotifyContext(
        input.paymentId,
      );
      if (!ctx || ctx.status !== 'SUCCEEDED') return;
      customerId = ctx.customerId;
      publicReference = ctx.publicReference;
    }
    const accountId =
      await this.notifications.findCustomerAccountIdByCustomerId(customerId);
    if (!accountId) return;
    const copy = copyPaymentSucceeded(publicReference);
    await this.emitSafe({
      type: NOTIFICATION_TYPE_PAYMENT_SUCCEEDED,
      sourceId: input.paymentId,
      accountId,
      ...copy,
    });
  }

  async notifyRefundRefunded(input: {
    refundId: string;
    customerId?: string;
    publicReference?: string;
  }): Promise<void> {
    let customerId = input.customerId;
    let publicReference = input.publicReference;
    if (!customerId || !publicReference) {
      const ctx = await this.notifications.findRefundNotifyContext(
        input.refundId,
      );
      if (!ctx || ctx.status !== 'REFUNDED') return;
      customerId = ctx.customerId;
      publicReference = ctx.publicReference;
    }
    const accountId =
      await this.notifications.findCustomerAccountIdByCustomerId(customerId);
    if (!accountId) return;
    const copy = copyRefundRefunded(publicReference);
    await this.emitSafe({
      type: NOTIFICATION_TYPE_REFUND_REFUNDED,
      sourceId: input.refundId,
      accountId,
      ...copy,
    });
  }

  async notifySettlementFinalized(input: {
    settlementId: string;
    merchantId: string;
  }): Promise<void> {
    const accountIds =
      await this.notifications.listMerchantSettlementRecipientAccountIds(
        input.merchantId,
      );
    const copy = copySettlementFinalized();
    for (const accountId of accountIds) {
      await this.emitSafe({
        type: NOTIFICATION_TYPE_SETTLEMENT_FINALIZED,
        sourceId: input.settlementId,
        accountId,
        ...copy,
      });
    }
  }

  async notifyDriverEarningCreated(input: {
    earningId: string;
    driverId: string;
  }): Promise<void> {
    const accountId = await this.notifications.findDriverAccountIdByDriverId(
      input.driverId,
    );
    if (!accountId) return;
    const copy = copyDriverEarningCreated();
    await this.emitSafe({
      type: NOTIFICATION_TYPE_DRIVER_EARNING_CREATED,
      sourceId: input.earningId,
      accountId,
      ...copy,
    });
  }

  async notifyMerchantOrderCreated(input: {
    orderId: string;
    merchantId?: string;
    publicReference?: string;
  }): Promise<void> {
    let merchantId = input.merchantId;
    let publicReference = input.publicReference;
    if (!merchantId || !publicReference) {
      const ctx = await this.notifications.findOrderNotifyContext(
        input.orderId,
      );
      if (!ctx || !ctx.merchantId) return;
      merchantId = ctx.merchantId;
      publicReference = ctx.publicReference;
    }
    const accountIds =
      await this.notifications.listMerchantOrderRecipientAccountIds(merchantId);
    const copy = copyMerchantOrderCreated(publicReference);
    for (const accountId of accountIds) {
      await this.emitSafe({
        type: NOTIFICATION_TYPE_MERCHANT_ORDER_CREATED,
        sourceId: input.orderId,
        accountId,
        ...copy,
      });
    }
  }

  async listForAccount(
    accountId: string,
    query: { limit?: number; offset?: number },
  ): Promise<NotificationListView> {
    const page = normalizeNotificationListQuery(query);
    const listed = await this.notifications.listForAccount(accountId, page);
    const unreadCount = await this.notifications.countUnread(accountId);
    return {
      items: listed.items.map(toNotificationView),
      limit: page.limit,
      offset: page.offset,
      total: listed.total,
      unreadCount,
    };
  }

  async unreadCount(accountId: string): Promise<{ unreadCount: number }> {
    return {
      unreadCount: await this.notifications.countUnread(accountId),
    };
  }

  async markRead(
    accountId: string,
    notificationId: string,
  ): Promise<NotificationView> {
    const owned = await this.notifications.findOwned(accountId, notificationId);
    if (!owned) {
      throw notificationNotFound();
    }
    const updated = await this.notifications.markRead(
      accountId,
      notificationId,
    );
    return toNotificationView(updated);
  }

  async markAllRead(accountId: string): Promise<{ marked: number }> {
    const marked = await this.notifications.markAllRead(accountId);
    return { marked };
  }

  async registerDeviceToken(input: {
    accountId: string;
    token: string;
    platform: string;
    deviceId?: string | null;
  }): Promise<DeviceTokenRecord> {
    return this.notifications.upsertDeviceToken({
      accountId: requireAccountId(input.accountId),
      token: requirePushToken(input.token),
      platform: requireDeviceTokenPlatform(input.platform),
      deviceId: input.deviceId ?? null,
    });
  }

  async deactivateDeviceToken(accountId: string, token: string): Promise<void> {
    await this.notifications.deactivateDeviceToken(
      requireAccountId(accountId),
      requirePushToken(token),
    );
  }
}
