import { Inject, Injectable, Logger } from '@nestjs/common';
import { parseNotificationCategory } from '../domain/notification.policy';
import {
  NOTIFICATION_CHANNEL_PUSH,
  NOTIFICATION_DELIVERY_FAILED,
  NOTIFICATION_DELIVERY_PENDING,
  NOTIFICATION_DELIVERY_PROVIDER_ACCEPTED,
  NOTIFICATION_DELIVERY_SKIPPED_NO_ACTIVE_TOKEN,
  NOTIFICATION_DELIVERY_SKIPPED_NOT_CONFIGURED,
  NOTIFICATION_DELIVERY_SKIPPED_RECIPIENT_INELIGIBLE,
  NOTIFICATION_DELIVERY_SKIPPED_STALE_SOURCE,
  NOTIFICATION_TYPE_MERCHANT_ORDER_CREATED,
} from '../domain/notification.types';
import type { PushSendJobData } from '../domain/notification.jobs';
import { buildMerchantOrderPushMessage } from '../domain/push.policy';
import { PUSH_GATEWAY, type PushGateway } from '../domain/push.types';
import { NotificationRepository } from '../infrastructure/notification.repository';

const MERCHANT_ORDER_ROLES = new Set(['OWNER', 'MANAGER', 'STAFF']);

export type PushDispatchResult =
  /** Terminal: delivery log finalized with [status]. */
  | { kind: 'done'; status: string }
  /** Retryable failure; caller persists [data] and lets the queue retry. */
  | { kind: 'retry'; code: string; data: PushSendJobData };

/**
 * Sends one Notification's Push to the recipient's active DeviceTokens.
 * Runs after the IN_APP row is committed; never touches business state.
 * PROVIDER_ACCEPTED means the provider accepted the message — not that the
 * device received or displayed it.
 */
@Injectable()
export class PushDispatchService {
  private readonly logger = new Logger(PushDispatchService.name);

  constructor(
    private readonly notifications: NotificationRepository,
    @Inject(PUSH_GATEWAY) private readonly gateway: PushGateway,
  ) {}

  isConfigured(): boolean {
    return this.gateway.isConfigured();
  }

  async dispatch(
    data: PushSendJobData,
    opts: { finalAttempt: boolean },
  ): Promise<PushDispatchResult> {
    const notification = await this.notifications.findNotificationById(
      data.notificationId,
    );
    if (!notification) {
      return { kind: 'done', status: 'MISSING_NOTIFICATION' };
    }
    const log = await this.notifications.findDeliveryLog(
      notification.id,
      NOTIFICATION_CHANNEL_PUSH,
    );
    if (!log || log.status !== NOTIFICATION_DELIVERY_PENDING) {
      return { kind: 'done', status: log?.status ?? 'MISSING_LOG' };
    }

    const finish = async (
      status: string,
      providerReference: string | null,
      sent: boolean,
    ): Promise<PushDispatchResult> => {
      await this.notifications.updateDeliveryLog(log.id, {
        status,
        providerReference,
        sentAt: sent ? new Date() : null,
      });
      return { kind: 'done', status };
    };

    if (!this.gateway.isConfigured()) {
      return finish(NOTIFICATION_DELIVERY_SKIPPED_NOT_CONFIGURED, null, false);
    }

    const { type, sourceId } = parseNotificationCategory(notification.category);
    if (type !== NOTIFICATION_TYPE_MERCHANT_ORDER_CREATED) {
      return finish(NOTIFICATION_DELIVERY_SKIPPED_NOT_CONFIGURED, null, false);
    }

    const ctx = await this.notifications.findMerchantOrderPushContext(
      notification.accountId,
      sourceId,
    );
    if (
      ctx.accountStatus !== 'ACTIVE' ||
      !ctx.memberRole ||
      !MERCHANT_ORDER_ROLES.has(ctx.memberRole) ||
      !ctx.merchantId ||
      !ctx.branchId
    ) {
      return finish(
        NOTIFICATION_DELIVERY_SKIPPED_RECIPIENT_INELIGIBLE,
        null,
        false,
      );
    }
    if (
      ctx.orderStatus === 'CANCELLED' ||
      ctx.fulfillmentStatus !== 'PENDING_ACCEPTANCE'
    ) {
      return finish(NOTIFICATION_DELIVERY_SKIPPED_STALE_SOURCE, null, false);
    }

    const accepted = new Set(data.acceptedTokenIds ?? []);
    let firstReference = data.firstProviderReference ?? null;
    const tokens = (
      await this.notifications.findActiveDeviceTokens(notification.accountId)
    ).filter((t) => !accepted.has(t.id));

    if (tokens.length === 0) {
      return accepted.size > 0
        ? finish(NOTIFICATION_DELIVERY_PROVIDER_ACCEPTED, firstReference, true)
        : finish(NOTIFICATION_DELIVERY_SKIPPED_NO_ACTIVE_TOKEN, null, false);
    }

    let transientCode: string | null = null;
    let permanentCode: string | null = null;
    let invalidCount = 0;
    for (const token of tokens) {
      const outcome = await this.gateway.send(
        buildMerchantOrderPushMessage({
          token: token.token,
          platform: token.platform,
          title: notification.title,
          body: notification.body,
          notificationId: notification.id,
          orderId: sourceId,
          merchantId: ctx.merchantId,
          branchId: ctx.branchId,
        }),
      );
      switch (outcome.kind) {
        case 'accepted':
          accepted.add(token.id);
          firstReference ??= outcome.providerReference;
          break;
        case 'invalid_token':
          invalidCount += 1;
          await this.notifications.deactivateDeviceTokenById(token.id);
          this.logger.log(
            `push token deactivated id=${token.id} code=${outcome.code}`,
          );
          break;
        case 'transient':
          transientCode ??= outcome.code;
          break;
        case 'permanent':
          permanentCode ??= outcome.code;
          this.logger.warn(
            `push permanent failure notification=${notification.id} token=${token.id} code=${outcome.code}`,
          );
          break;
      }
    }

    if (transientCode && !opts.finalAttempt) {
      return {
        kind: 'retry',
        code: transientCode,
        data: {
          notificationId: notification.id,
          acceptedTokenIds: [...accepted],
          firstProviderReference: firstReference,
        },
      };
    }
    if (accepted.size > 0) {
      return finish(NOTIFICATION_DELIVERY_PROVIDER_ACCEPTED, firstReference, true);
    }
    if (transientCode) {
      return finish(
        NOTIFICATION_DELIVERY_FAILED,
        `push:retry_exhausted:${transientCode}`,
        false,
      );
    }
    if (permanentCode) {
      return finish(
        NOTIFICATION_DELIVERY_FAILED,
        `push:permanent:${permanentCode}`,
        false,
      );
    }
    return finish(
      NOTIFICATION_DELIVERY_FAILED,
      `push:all_tokens_invalid:${invalidCount}`,
      false,
    );
  }
}
