import { Injectable } from '@nestjs/common';
import { customerProfileNotFound } from '../../customers/domain/customer.errors';
import {
  refundAdminRequired,
  refundFinancialStateInvalid,
  refundInvalidState,
  refundNotFound,
  refundProviderUnsupported,
} from '../domain/refund.errors';
import {
  ORIGINAL_PAYMENT_UNSUPPORTED_MESSAGE,
  calculateRefundCapacity,
  canAuthorizeRefund,
  canConfirmManualRefund,
  canFailRefund,
  canMarkUnderReview,
  canRejectRefund,
  nextAuthorizedStatus,
  nextFailedStatus,
  nextRefundedStatus,
  nextRejectedStatus,
  nextUnderReviewStatus,
  requireEligibleOrderStatus,
  requirePaymentSnapshotConsistency,
  requirePositiveRefundAmount,
  requireRefundReason,
  requireRefundableAmount,
  requireSucceededPayment,
  resolveRefundMethodBinding,
} from '../domain/refund.policy';
import {
  REFUND_CURRENCY_DZD,
  REFUND_METHOD_ORIGINAL_PAYMENT,
  REFUND_STATUS_APPROVED,
  REFUND_STATUS_PROCESSING,
  REFUND_STATUS_REFUNDED,
  REFUND_STATUS_REQUESTED,
  REFUND_STATUS_UNDER_REVIEW,
  type CustomerOrderRefundsView,
  type CustomerRefundView,
  type RefundCapacitySummary,
  type RefundMethod,
  type RefundRecord,
  type RefundStatus,
} from '../domain/refund.types';
import { RefundRepository } from '../infrastructure/refund.repository';
import { FinancialLedgerService } from '../../financial-ledger/application/financial-ledger.service';
import { NotificationService } from '../../notifications/application/notification.service';

export type CreateRefundCommand = {
  orderId: string;
  amountMinor: number;
  reason: string;
  refundMethod: RefundMethod;
  /** Required trusted AdminProfile id (schema FK + verified). */
  requestedByAdminId: string;
  internalNote?: string | null;
};

export type TrustedRefundAction = {
  /** Verified AdminProfile performing the action. */
  adminId: string;
  internalNote?: string | null;
};

@Injectable()
export class RefundService {
  constructor(
    private readonly refunds: RefundRepository,
    private readonly ledger: FinancialLedgerService,
    private readonly notifications: NotificationService,
  ) {}

  private async requireTrustedAdmin(adminId: string): Promise<void> {
    if (!(await this.refunds.adminExists(adminId))) {
      throw refundAdminRequired();
    }
  }

  async createRefund(command: CreateRefundCommand): Promise<RefundRecord> {
    requirePositiveRefundAmount(command.amountMinor);
    const reason = requireRefundReason(command.reason);
    await this.requireTrustedAdmin(command.requestedByAdminId);

    if (command.refundMethod === REFUND_METHOD_ORIGINAL_PAYMENT) {
      throw refundProviderUnsupported(ORIGINAL_PAYMENT_UNSUPPORTED_MESSAGE);
    }

    return this.refunds.runInTransaction(async (tx) => {
      const context = await this.refunds.findFinancialContextByOrderId(
        command.orderId,
        tx,
      );
      if (!context) {
        throw refundFinancialStateInvalid(
          'Order Payment and financial snapshot are required for Refund',
        );
      }

      const locked = await this.refunds.lockPayment(context.paymentId, tx);
      if (!locked) {
        throw refundFinancialStateInvalid('Payment could not be locked');
      }

      // Re-read Order status under Payment serialization root.
      const fresh = await this.refunds.findFinancialContextByOrderId(
        command.orderId,
        tx,
      );
      if (!fresh) {
        throw refundFinancialStateInvalid();
      }

      requireSucceededPayment(locked.status);
      requireEligibleOrderStatus(fresh.orderStatus);
      requirePaymentSnapshotConsistency({
        paymentAmountMinor: locked.amountMinor,
        snapshotPayableMinor: fresh.snapshotPayableMinor,
        paymentCurrency: locked.currency,
        snapshotCurrency: fresh.snapshotCurrency,
      });

      const totals = await this.refunds.sumReservedAndSuccessful(
        command.orderId,
        tx,
      );
      const capacity = calculateRefundCapacity({
        originalPaidMinor: locked.amountMinor,
        reservedRefundMinor: totals.reservedRefundMinor,
        successfulRefundMinor: totals.successfulRefundMinor,
        currency: locked.currency,
      });
      requireRefundableAmount(
        command.amountMinor,
        capacity.remainingRefundableMinor,
      );

      const binding = resolveRefundMethodBinding({
        refundMethod: command.refundMethod,
        paymentMethod: locked.method,
        paymentTransactionId: null,
      });

      return this.refunds.createRefund(
        {
          orderId: command.orderId,
          paymentTransactionId: binding.paymentTransactionId,
          refundMethod: binding.refundMethod,
          amountMinor: command.amountMinor,
          status: REFUND_STATUS_REQUESTED,
          reason,
          internalNote: command.internalNote ?? null,
          requestedByAdminId: command.requestedByAdminId,
        },
        tx,
      );
    });
  }

  /** Optional review: REQUESTED → UNDER_REVIEW. */
  async markUnderReview(
    refundId: string,
    action: TrustedRefundAction,
  ): Promise<RefundRecord> {
    await this.requireTrustedAdmin(action.adminId);
    return this.transitionRefund(refundId, {
      allowed: canMarkUnderReview,
      toStatus: nextUnderReviewStatus(),
      fromStatuses: [REFUND_STATUS_REQUESTED],
      idempotentStatus: REFUND_STATUS_UNDER_REVIEW,
      invalidMessage: 'Only REQUESTED Refunds can enter UNDER_REVIEW',
      internalNote: action.internalNote,
    });
  }

  /**
   * Trusted authorization: REQUESTED | UNDER_REVIEW → APPROVED.
   * Does not mean Customer has received money.
   */
  async authorizeRefund(
    refundId: string,
    action: TrustedRefundAction,
  ): Promise<RefundRecord> {
    await this.requireTrustedAdmin(action.adminId);
    return this.transitionRefund(refundId, {
      allowed: canAuthorizeRefund,
      toStatus: nextAuthorizedStatus(),
      fromStatuses: [REFUND_STATUS_REQUESTED, REFUND_STATUS_UNDER_REVIEW],
      idempotentStatus: REFUND_STATUS_APPROVED,
      invalidMessage:
        'Only REQUESTED or UNDER_REVIEW Refunds can be authorized',
      internalNote: action.internalNote,
    });
  }

  async rejectRefund(
    refundId: string,
    action: TrustedRefundAction,
  ): Promise<RefundRecord> {
    await this.requireTrustedAdmin(action.adminId);
    return this.transitionRefund(refundId, {
      allowed: canRejectRefund,
      toStatus: nextRejectedStatus(),
      fromStatuses: [REFUND_STATUS_REQUESTED, REFUND_STATUS_UNDER_REVIEW],
      idempotentStatus: nextRejectedStatus(),
      invalidMessage: 'Only REQUESTED or UNDER_REVIEW Refunds can be rejected',
      internalNote: action.internalNote,
    });
  }

  /**
   * Confirms MANUAL_COD / MANUAL_OTHER money return.
   * APPROVED → REFUNDED (+ completedAt). Replay of REFUNDED is deterministic.
   */
  async confirmManualRefund(
    refundId: string,
    action: TrustedRefundAction,
  ): Promise<RefundRecord> {
    await this.requireTrustedAdmin(action.adminId);

    const refund = await this.refunds.runInTransaction(async (tx) => {
      const seed = await this.refunds.findById(refundId, tx);
      if (!seed) {
        throw refundNotFound();
      }
      const context = await this.refunds.findFinancialContextByOrderId(
        seed.orderId,
        tx,
      );
      if (!context) {
        throw refundFinancialStateInvalid();
      }
      const locked = await this.refunds.lockPayment(context.paymentId, tx);
      if (!locked) {
        throw refundFinancialStateInvalid('Payment could not be locked');
      }
      requireSucceededPayment(locked.status);

      const current = await this.refunds.findById(refundId, tx);
      if (!current) {
        throw refundNotFound();
      }

      if (current.status === REFUND_STATUS_REFUNDED) {
        await this.ledger.postRefundRefunded(
          {
            refundId: current.id,
            orderId: current.orderId,
            amountMinor: current.amountMinor,
          },
          tx,
        );
        return current;
      }
      if (!canConfirmManualRefund(current.status, current.refundMethod)) {
        throw refundInvalidState(
          'Manual confirmation requires APPROVED MANUAL_COD or MANUAL_OTHER Refund',
        );
      }

      const updated = await this.refunds.updateStatus(
        {
          refundId,
          status: nextRefundedStatus(),
          fromStatuses: [REFUND_STATUS_APPROVED],
          setCompletedAt: true,
          internalNote:
            action.internalNote === undefined
              ? current.internalNote
              : action.internalNote,
        },
        tx,
      );
      if (!updated) {
        throw refundNotFound();
      }
      if (updated.status !== REFUND_STATUS_REFUNDED) {
        throw refundInvalidState(
          'Concurrent Refund transition prevented manual confirmation',
        );
      }
      await this.ledger.postRefundRefunded(
        {
          refundId: updated.id,
          orderId: updated.orderId,
          amountMinor: updated.amountMinor,
        },
        tx,
      );
      return updated;
    });
    await this.notifications.notifyRefundRefunded({ refundId: refund.id });
    return refund;
  }

  /**
   * ORIGINAL_PAYMENT / provider execution is disabled in Refunds v1.0.
   * Does not move status to PROCESSING or FAILED.
   */
  attemptProviderRefund(_refundId: string): never {
    throw refundProviderUnsupported(ORIGINAL_PAYMENT_UNSUPPORTED_MESSAGE);
  }

  /**
   * Marks an actually attempted execution as FAILED (releases capacity).
   * Must not be used for unsupported capability.
   */
  async failRefund(
    refundId: string,
    action: TrustedRefundAction,
  ): Promise<RefundRecord> {
    await this.requireTrustedAdmin(action.adminId);
    return this.transitionRefund(refundId, {
      allowed: canFailRefund,
      toStatus: nextFailedStatus(),
      fromStatuses: [REFUND_STATUS_APPROVED, REFUND_STATUS_PROCESSING],
      idempotentStatus: nextFailedStatus(),
      invalidMessage:
        'Only APPROVED or PROCESSING Refunds can be marked FAILED after an actual execution attempt',
      internalNote: action.internalNote,
    });
  }

  async getCapacity(orderId: string): Promise<RefundCapacitySummary> {
    const context = await this.refunds.findFinancialContextByOrderId(orderId);
    if (!context) {
      throw refundFinancialStateInvalid(
        'Order Payment and financial snapshot are required',
      );
    }
    requireSucceededPayment(context.paymentStatus);
    requirePaymentSnapshotConsistency({
      paymentAmountMinor: context.paymentAmountMinor,
      snapshotPayableMinor: context.snapshotPayableMinor,
      paymentCurrency: context.paymentCurrency,
      snapshotCurrency: context.snapshotCurrency,
    });
    const totals = await this.refunds.sumReservedAndSuccessful(orderId);
    return calculateRefundCapacity({
      originalPaidMinor: context.paymentAmountMinor,
      reservedRefundMinor: totals.reservedRefundMinor,
      successfulRefundMinor: totals.successfulRefundMinor,
      currency: context.paymentCurrency,
    });
  }

  async listCustomerOrderRefunds(
    accountId: string,
    orderId: string,
  ): Promise<CustomerOrderRefundsView> {
    const customerId = await this.refunds.findCustomerIdByAccountId(accountId);
    if (!customerId) {
      throw customerProfileNotFound();
    }

    const context = await this.refunds.findFinancialContextByOrderId(orderId);
    if (!context || context.customerId !== customerId) {
      throw refundNotFound();
    }

    const totals = await this.refunds.sumReservedAndSuccessful(orderId);
    const capacity = calculateRefundCapacity({
      originalPaidMinor: context.paymentAmountMinor,
      reservedRefundMinor: totals.reservedRefundMinor,
      successfulRefundMinor: totals.successfulRefundMinor,
      currency: context.paymentCurrency,
    });
    const rows = await this.refunds.listByOrderId(orderId);
    return {
      orderId,
      originalPaidMinor: capacity.originalPaidMinor,
      reservedRefundMinor: capacity.reservedRefundMinor,
      successfulRefundMinor: capacity.successfulRefundMinor,
      remainingRefundableMinor: capacity.remainingRefundableMinor,
      currency: capacity.currency,
      refunds: rows.map(toCustomerView),
    };
  }

  private async transitionRefund(
    refundId: string,
    input: {
      allowed: (status: RefundStatus) => boolean;
      toStatus: RefundStatus;
      fromStatuses: RefundStatus[];
      idempotentStatus: RefundStatus;
      invalidMessage: string;
      internalNote?: string | null;
    },
  ): Promise<RefundRecord> {
    return this.refunds.runInTransaction(async (tx) => {
      const seed = await this.refunds.findById(refundId, tx);
      if (!seed) {
        throw refundNotFound();
      }
      const context = await this.refunds.findFinancialContextByOrderId(
        seed.orderId,
        tx,
      );
      if (!context) {
        throw refundFinancialStateInvalid();
      }
      await this.refunds.lockPayment(context.paymentId, tx);

      const refund = await this.refunds.findById(refundId, tx);
      if (!refund) {
        throw refundNotFound();
      }

      if (refund.status === input.idempotentStatus) {
        return refund;
      }
      if (!input.allowed(refund.status)) {
        throw refundInvalidState(input.invalidMessage);
      }

      const updated = await this.refunds.updateStatus(
        {
          refundId,
          status: input.toStatus,
          fromStatuses: input.fromStatuses,
          internalNote:
            input.internalNote === undefined
              ? refund.internalNote
              : input.internalNote,
        },
        tx,
      );
      if (!updated) {
        throw refundNotFound();
      }
      if (updated.status !== input.toStatus) {
        throw refundInvalidState(
          'Concurrent Refund transition prevented this action',
        );
      }
      return updated;
    });
  }
}

function toCustomerView(row: RefundRecord): CustomerRefundView {
  return {
    refundId: row.id,
    amountMinor: row.amountMinor,
    currency: REFUND_CURRENCY_DZD,
    status: row.status,
    method: row.refundMethod,
    reason: row.reason,
    requestedAt: row.requestedAt,
    completedAt: row.completedAt,
  };
}
