import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  notificationIntegrityConflict,
  notificationNotFound,
} from '../domain/notification.errors';
import { adminNotificationPermissionFor } from '../domain/admin-notification.policy';
import {
  ADMIN_TEMPLATE_AUDIENCE,
  ADMIN_TEMPLATE_CHANNEL_IN_APP,
  ADMIN_TEMPLATE_DEFAULTS,
  ADMIN_TEMPLATE_LOCALES,
  adminTemplateCode,
  factoryFallbackCopy,
  normalizeAdminTemplateLocale,
  renderAdminTemplate,
  type AdminTemplateLocale,
} from '../domain/admin-notification-template.policy';
import {
  buildNotificationCategory,
  copyDeliveryCompleted,
  copyDriverAssigned,
  copyDriverEarningCreated,
  copyMatchOffer,
  copyMerchantOrderCreated,
  copyOrderAccepted,
  copyOrderCancelled,
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
  NOTIFICATION_DELIVERY_PENDING,
  NOTIFICATION_DELIVERY_SENT,
  NOTIFICATION_DELIVERY_SKIPPED_NOT_CONFIGURED,
  NOTIFICATION_PUSH_ENABLED_TYPES,
  NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF,
  NOTIFICATION_TYPE_ADMIN_MERCHANT_VERIF,
  NOTIFICATION_TYPE_ADMIN_SUPPORT_TICKET,
  NOTIFICATION_TYPE_DELIVERY_COMPLETED,
  NOTIFICATION_TYPE_DRIVER_ASSIGNED,
  NOTIFICATION_TYPE_DRIVER_EARNING_CREATED,
  NOTIFICATION_TYPE_MATCH_OFFER,
  NOTIFICATION_TYPE_MERCHANT_ORDER_CREATED,
  NOTIFICATION_TYPE_ORDER_ACCEPTED,
  NOTIFICATION_TYPE_ORDER_CANCELLED,
  NOTIFICATION_TYPE_ORDER_READY,
  NOTIFICATION_TYPE_ORDER_REJECTED,
  NOTIFICATION_TYPE_PAYMENT_SUCCEEDED,
  NOTIFICATION_TYPE_REFUND_REFUNDED,
  NOTIFICATION_TYPE_SETTLEMENT_FINALIZED,
  type DeviceTokenRecord,
  type EmitNotificationInput,
  type NotificationListView,
  type NotificationRecord,
  type NotificationTypeAdminV1,
  type NotificationView,
} from '../domain/notification.types';
import {
  NOTIFICATION_JOBS,
  type NotificationJobs,
} from '../domain/notification.jobs';
import {
  NotificationRepository,
  type OrmClient,
} from '../infrastructure/notification.repository';
import { PushDispatchService } from './push-dispatch.service';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly notifications: NotificationRepository,
    private readonly push: PushDispatchService,
    @Inject(NOTIFICATION_JOBS) private readonly jobs: NotificationJobs,
  ) {}

  /**
   * Create at-most-one logical Notification for (type, sourceId, accountId).
   * Records IN_APP delivery as SENT. Never calls the Push provider inline:
   * push-enabled types get a PENDING Push log (sent post-commit by the queue);
   * everything else is logged SKIPPED_NOT_CONFIGURED.
   */
  async emitLogical(
    input: EmitNotificationInput,
    client?: OrmClient,
  ): Promise<{
    notification: NotificationRecord;
    created: boolean;
    pushPending: boolean;
  }> {
    const accountId = requireAccountId(input.accountId);
    const sourceId = requireSourceId(input.sourceId);
    requireTitleBody(input.title, input.body);
    const category = buildNotificationCategory(input.type, sourceId);
    const pushPending =
      NOTIFICATION_PUSH_ENABLED_TYPES.includes(input.type) &&
      this.push.isConfigured();

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
        return {
          notification: existing[0],
          created: false,
          pushPending: false,
        };
      }
      const notification = await this.notifications.createNotification(
        {
          accountId,
          title: input.title.trim(),
          body: input.body.trim(),
          category,
          templateId: input.templateId ?? null,
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
          status: pushPending
            ? NOTIFICATION_DELIVERY_PENDING
            : NOTIFICATION_DELIVERY_SKIPPED_NOT_CONFIGURED,
          providerReference: null,
          sentAt: null,
        },
        tx,
      );
      return { notification, created: true, pushPending };
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
    let emitted: Awaited<ReturnType<NotificationService['emitLogical']>>;
    try {
      emitted = await this.emitLogical(input);
    } catch (error) {
      this.logger.warn(
        `notification emit failed type=${input.type} source=${input.sourceId} account=${input.accountId} err=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }
    if (!emitted.created || !emitted.pushPending) {
      return;
    }
    try {
      await this.jobs.enqueuePushSend(emitted.notification.id);
    } catch (error) {
      // Log stays PENDING; NotificationRecoveryService re-enqueues it.
      this.logger.warn(
        `push enqueue failed notification=${emitted.notification.id} err=${
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

  async notifyOrderCancelled(input: {
    orderId: string;
    customerId: string;
    publicReference: string;
    refundRequired: boolean;
    refundStatus: string | null;
  }): Promise<void> {
    const accountId =
      await this.notifications.findCustomerAccountIdByCustomerId(
        input.customerId,
      );
    if (!accountId) return;
    const copy = copyOrderCancelled(
      input.publicReference,
      input.refundRequired,
    );
    await this.emitSafe({
      type: NOTIFICATION_TYPE_ORDER_CANCELLED,
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

  /**
   * Fan-out Admin operational notification. Best-effort after the business
   * commit (never rolls back the source TX). Optional resurface marks an
   * existing row unread, refreshes copy, and bumps createdAt — used for
   * Driver re-submit after reject (same sourceId = driver profile id).
   * Recovery must pass resurfaceIfExists:false so an unchanged PENDING_REVIEW
   * gap-fill does not reopen a read receipt. Merchant uses submission id so
   * each formal submit is a distinct category.
   *
   * Title/body are resolved **per recipient** from AdminProfile.preferredLocale
   * (never from the source Driver/Merchant/Customer). Persisted snapshots are
   * immutable on later template edits; live resurface refreshes copy from the
   * current template for that recipient's locale only.
   */
  async notifyAdminAudience(input: {
    type: NotificationTypeAdminV1;
    sourceId: string;
    vars: Record<string, string>;
    resurfaceIfExists?: boolean;
  }): Promise<void> {
    const permission = adminNotificationPermissionFor(input.type);
    const recipients =
      await this.notifications.findAdminRecipientsWithPermission(permission);
    for (const recipient of recipients) {
      const locale = normalizeAdminTemplateLocale(recipient.preferredLocale);
      const copy = await this.resolveAdminEmitCopy(
        input.type,
        input.vars,
        locale,
      );
      let emitted: Awaited<ReturnType<NotificationService['emitLogical']>>;
      try {
        emitted = await this.emitLogical({
          type: input.type,
          sourceId: input.sourceId,
          accountId: recipient.accountId,
          title: copy.title,
          body: copy.body,
          templateId: copy.templateId,
        });
      } catch (error) {
        this.logger.warn(
          `notification emit failed type=${input.type} source=${input.sourceId} account=${recipient.accountId} err=${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        continue;
      }
      // Live Driver resubmit: always resurface existing rows (unread + copy +
      // createdAt). Recovery passes resurfaceIfExists:false and must not reopen
      // read receipts or bump timestamps for an unchanged PENDING_REVIEW gap-fill.
      if (!emitted.created && input.resurfaceIfExists) {
        try {
          await this.notifications.resurfaceOwned(
            recipient.accountId,
            emitted.notification.id,
            copy.title,
            copy.body,
          );
        } catch (error) {
          this.logger.warn(
            `notification resurface failed id=${emitted.notification.id} err=${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      if (!emitted.created || !emitted.pushPending) {
        continue;
      }
      try {
        await this.jobs.enqueuePushSend(emitted.notification.id);
      } catch (error) {
        this.logger.warn(
          `push enqueue failed notification=${emitted.notification.id} err=${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  /**
   * Resolve active catalogue row for the recipient locale → render;
   * else locale-scoped factory fallback (never the other locale's catalogue).
   * Does not mutate existing Notification rows.
   */
  async resolveAdminEmitCopy(
    type: NotificationTypeAdminV1,
    vars: Record<string, string>,
    locale: AdminTemplateLocale = 'fr',
  ): Promise<{ title: string; body: string; templateId: string | null }> {
    const code = adminTemplateCode(type, locale);
    try {
      const row =
        await this.notifications.findNotificationTemplateByCode(code);
      if (row && row.active) {
        const rendered = renderAdminTemplate(
          row.titleTemplate,
          row.bodyTemplate,
          vars,
        );
        if (rendered.title.length > 0 && rendered.body.length > 0) {
          return {
            title: rendered.title,
            body: rendered.body,
            templateId: row.id,
          };
        }
      }
    } catch (error) {
      this.logger.warn(
        `admin template resolve failed type=${type} locale=${locale} err=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const fallback = factoryFallbackCopy(type, vars, locale);
    return { ...fallback, templateId: null };
  }

  /** Idempotent seed of the six Admin IN_APP catalogue rows (fr+ar × 3 types). */
  async ensureAdminNotificationTemplates(): Promise<void> {
    const types: NotificationTypeAdminV1[] = [
      NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF,
      NOTIFICATION_TYPE_ADMIN_MERCHANT_VERIF,
      NOTIFICATION_TYPE_ADMIN_SUPPORT_TICKET,
    ];
    for (const type of types) {
      for (const locale of ADMIN_TEMPLATE_LOCALES) {
        const code = adminTemplateCode(type, locale as AdminTemplateLocale);
        const existing =
          await this.notifications.findNotificationTemplateByCode(code);
        if (existing) continue;
        const defaults = ADMIN_TEMPLATE_DEFAULTS[type][locale];
        await this.notifications.createNotificationTemplate({
          code,
          audience: ADMIN_TEMPLATE_AUDIENCE,
          trigger: type,
          channel: ADMIN_TEMPLATE_CHANNEL_IN_APP,
          titleTemplate: defaults.title,
          bodyTemplate: defaults.body,
          active: true,
        });
      }
    }
  }

  async notifyAdminDriverVerificationSubmitted(input: {
    driverId: string;
    driverFullName: string;
    /** When true (live submit), refresh unread if a prior row exists. */
    resurfaceIfExists?: boolean;
  }): Promise<void> {
    await this.notifyAdminAudience({
      type: NOTIFICATION_TYPE_ADMIN_DRIVER_VERIF,
      sourceId: input.driverId,
      resurfaceIfExists: input.resurfaceIfExists ?? true,
      vars: { driverFullName: input.driverFullName },
    });
  }

  async notifyAdminMerchantVerificationSubmitted(input: {
    /** MerchantVerificationSubmission id — idempotency + distinct later submits. */
    submissionId: string;
    merchantId: string;
    merchantName: string;
    publicReference: string;
  }): Promise<void> {
    await this.notifyAdminAudience({
      type: NOTIFICATION_TYPE_ADMIN_MERCHANT_VERIF,
      sourceId: input.submissionId,
      vars: {
        merchantName: input.merchantName,
        publicReference: input.publicReference,
      },
    });
  }

  async notifyAdminSupportTicketCreated(input: {
    ticketId: string;
    publicReference: string;
    subject: string | null;
  }): Promise<void> {
    await this.notifyAdminAudience({
      type: NOTIFICATION_TYPE_ADMIN_SUPPORT_TICKET,
      sourceId: input.ticketId,
      vars: {
        publicReference: input.publicReference,
        subject: input.subject?.trim() || '—',
      },
    });
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
