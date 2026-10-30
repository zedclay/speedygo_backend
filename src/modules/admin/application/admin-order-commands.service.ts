import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/database.module';
import { MatchingService } from '../../matching/application/matching.service';
import { NotificationService } from '../../notifications/application/notification.service';
import {
  assertAdminCancellationAllowed,
  inspectAdminCancellation,
  normalizeAdminCancellationReason,
  PAID_TERMINAL_REASON_ADMIN_CANCEL,
} from '../../orders/domain/admin-order-cancellation.policy';
import {
  electronicPaymentRequiresRefundIntent,
} from '../../orders/domain/customer-order-cancellation.policy';
import {
  orderCancellationCodCollected,
  orderCancellationConflict,
  orderCancellationFulfillmentActive,
  orderNotFound,
} from '../../orders/domain/order.errors';
import { OrderRepository } from '../../orders/infrastructure/order.repository';
import { PaidTerminalRefundService } from '../../refunds/application/paid-terminal-refund.service';
import { REFUND_REQUEST_ORIGIN_ADMIN_ORDER_CANCELLATION } from '../../refunds/domain/refund.types';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
} from '../domain/admin-audit-actions';
import { adminInvalidInput, adminNotFound } from '../domain/admin.errors';
import type { CurrentAdminContext } from '../domain/admin.types';
import { AdminAuditService } from './admin-audit.service';

const REASON_MAX = 255;

export type AdminAssignOfferView = {
  orderId: string;
  deliveryId: string;
  assignmentId: string;
  driverId: string;
  assignmentStatus: string;
  deliveryStatus: string;
  supersededPreviousOffer: boolean;
};

export type AdminOrderCancelView = {
  orderId: string;
  orderStatus: string;
  cancellationAccepted: true;
  cancelledAt: string | null;
  refundRequired: boolean;
  refundId: string | null;
  refundStatus: string | null;
  refundAmountMinor: string | null;
};

/**
 * Admin Order Operations v1.0 mutations.
 * Actor identity always from CurrentAdmin — never from body.
 * Domain mutation + AuditLog commit together; notifications after commit.
 */
@Injectable()
export class AdminOrderCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
    private readonly orders: OrderRepository,
    private readonly paidTerminalRefunds: PaidTerminalRefundService,
    private readonly audit: AdminAuditService,
    private readonly notifications: NotificationService,
  ) {}

  async assignOffer(
    admin: CurrentAdminContext,
    orderId: string,
    driverId: string,
    reasonRaw: string,
  ): Promise<AdminAssignOfferView> {
    const reason = this.requireReason(reasonRaw);
    const exists = await this.prisma
      .getDb()
      .orm.public.Order.where({ id: orderId })
      .first();
    if (!exists) {
      throw adminNotFound('Order not found');
    }

    const offered = await this.matching.adminCreateOfferForOrder(
      orderId,
      driverId,
    );

    const view: AdminAssignOfferView = {
      orderId,
      deliveryId: offered.deliveryId,
      assignmentId: offered.assignment.id,
      driverId: offered.assignment.driverId,
      assignmentStatus: offered.assignment.status,
      deliveryStatus: offered.deliveryStatus,
      supersededPreviousOffer: offered.supersededPreviousOffer,
    };

    // Offer commits in Matching TX first; AuditLog follows (retry is idempotent
    // when the same driver already holds the open offer).
    await this.prisma.getDb().transaction(async (tx) => {
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.ORDER_ASSIGN_OFFER,
        targetType: ADMIN_AUDIT_TARGET_TYPES.ORDER,
        targetId: orderId,
        afterJson: { ...view, reason },
        sessionId: admin.sessionId,
      });
    });

    return view;
  }

  async cancelEarly(
    admin: CurrentAdminContext,
    orderId: string,
    reasonRaw: string,
  ): Promise<AdminOrderCancelView> {
    const reason = normalizeAdminCancellationReason(reasonRaw);
    let result!: AdminOrderCancelView;
    let customerId = '';
    let publicReference = '';

    await this.prisma.getDb().transaction(async (tx) => {
      const locked = await this.orders.lockOrder(orderId, tx);
      if (!locked) {
        throw orderNotFound();
      }
      customerId = locked.customerId;
      publicReference = locked.publicReference;

      const decision = inspectAdminCancellation(
        locked.status,
        locked.fulfillmentStatus,
      );
      assertAdminCancellationAllowed(decision);

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
              origin: REFUND_REQUEST_ORIGIN_ADMIN_ORDER_CANCELLATION,
              reason: PAID_TERMINAL_REASON_ADMIN_CANCEL,
              requestedByAdminId: admin.adminProfileId,
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
        await this.audit.recordInTx(tx, {
          adminId: admin.adminProfileId,
          action: ADMIN_AUDIT_ACTIONS.ORDER_CANCEL,
          targetType: ADMIN_AUDIT_TARGET_TYPES.ORDER,
          targetId: orderId,
          afterJson: { ...result, reason, idempotent: true },
          sessionId: admin.sessionId,
        });
        return;
      }

      const applied = await this.orders.applyAdminCancel(
        orderId,
        admin.accountId,
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
            origin: REFUND_REQUEST_ORIGIN_ADMIN_ORDER_CANCELLATION,
            reason: PAID_TERMINAL_REASON_ADMIN_CANCEL,
            requestedByAdminId: admin.adminProfileId,
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

      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.ORDER_CANCEL,
        targetType: ADMIN_AUDIT_TARGET_TYPES.ORDER,
        targetId: orderId,
        afterJson: { ...result, reason, idempotent: false },
        sessionId: admin.sessionId,
      });
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

  private requireReason(raw: string): string {
    const trimmed = (raw ?? '').trim();
    if (trimmed.length === 0) {
      throw adminInvalidInput('reason is required');
    }
    if (trimmed.length > REASON_MAX) {
      throw adminInvalidInput(`reason must be at most ${REASON_MAX} characters`);
    }
    for (let i = 0; i < trimmed.length; i += 1) {
      const code = trimmed.charCodeAt(i);
      if (code < 32 || code === 127 || trimmed[i] === '<' || trimmed[i] === '>') {
        throw adminInvalidInput(
          'reason must not contain HTML or control characters',
        );
      }
    }
    return trimmed;
  }
}
