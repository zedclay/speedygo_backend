import { Injectable } from '@nestjs/common';
import { isPostgresUniqueViolation } from '../../../common/errors/postgres-unique';
import { moneyMinorToDecimalString } from '../../../common/money/money-minor';
import { orderCancellationRefundRequired } from '../../orders/domain/order.errors';
import { refundFinancialStateInvalid } from '../domain/refund.errors';
import {
  calculateRefundCapacity,
  requireEligibleOrderStatus,
  requirePaymentSnapshotConsistency,
  requireSucceededPayment,
} from '../domain/refund.policy';
import {
  PAID_TERMINAL_REFUND_ORIGINS,
  REFUND_METHOD_MANUAL_OTHER,
  REFUND_STATUS_REQUESTED,
  type RefundRecord,
  type RefundRequestOrigin,
  type RefundStatus,
} from '../domain/refund.types';
import {
  RefundRepository,
  type OrmClient,
} from '../infrastructure/refund.repository';

export type PaidTerminalRefundIntentView = {
  refundId: string;
  refundStatus: RefundStatus;
  refundAmountMinor: string;
  created: boolean;
  requestOrigin: RefundRequestOrigin;
};

const PAID_TERMINAL_INTENT_KEY_PREFIX = 'paid-terminal:v1:';
const PAYMENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deterministic server-only paid-terminal Refund identity.
 * Never client-supplied. Never public API.
 */
export function paidTerminalIntentKeyForPayment(paymentId: string): string {
  const trimmed = paymentId.trim();
  if (!PAYMENT_ID_PATTERN.test(trimmed)) {
    throw orderCancellationRefundRequired(
      'Paid-terminal Refund intent requires an authoritative Payment id',
    );
  }
  return `${PAID_TERMINAL_INTENT_KEY_PREFIX}${trimmed}`;
}

export function isPaidTerminalRefundOrigin(
  origin: string,
): origin is RefundRequestOrigin {
  return (PAID_TERMINAL_REFUND_ORIGINS as readonly string[]).includes(origin);
}

/**
 * Central paid-terminal Refund coupling with DB uniqueness.
 *
 * Refund REQUESTED ≠ money returned. Only REFUNDED + completedAt is completed.
 * Provider auto-refund unsupported (MANUAL_OTHER). First durable creator freezes origin.
 */
@Injectable()
export class PaidTerminalRefundService {
  constructor(private readonly refunds: RefundRepository) {}

  async ensureRefundIntentInTx(
    tx: OrmClient,
    input: {
      orderId: string;
      origin: RefundRequestOrigin;
      reason: string;
      internalNote?: string | null;
    },
  ): Promise<PaidTerminalRefundIntentView> {
    if (!isPaidTerminalRefundOrigin(input.origin)) {
      throw orderCancellationRefundRequired(
        'Paid-terminal Refund intent requires an automatic request origin',
      );
    }

    const context = await this.refunds.findFinancialContextByOrderId(
      input.orderId,
      tx,
    );
    if (!context) {
      throw refundFinancialStateInvalid(
        'Order Payment and financial snapshot are required for paid-terminal Refund',
      );
    }

    const locked = await this.refunds.lockPayment(context.paymentId, tx);
    if (!locked) {
      throw refundFinancialStateInvalid('Payment could not be locked');
    }

    const fresh = await this.refunds.findFinancialContextByOrderId(
      input.orderId,
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

    if (locked.method !== 'ELECTRONIC') {
      throw orderCancellationRefundRequired(
        'Paid-terminal Refund intent applies only to electronic Payment success',
      );
    }

    const intentKey = paidTerminalIntentKeyForPayment(locked.id);
    const existingByKey = await this.refunds.findByPaidTerminalIntentKey(
      intentKey,
      tx,
    );
    if (existingByKey) {
      return this.toIntentView(existingByKey, false);
    }

    const totals = await this.refunds.sumReservedAndSuccessful(
      input.orderId,
      tx,
    );
    const capacity = calculateRefundCapacity({
      originalPaidMinor: locked.amountMinor,
      reservedRefundMinor: totals.reservedRefundMinor,
      successfulRefundMinor: totals.successfulRefundMinor,
      currency: locked.currency,
    });

    if (capacity.remainingRefundableMinor <= 0) {
      // Capacity already reserved (e.g. legacy ADMIN/partial rows) — reuse
      // the latest reserving row rather than inventing another intent.
      const existing = await this.refunds.listByOrderId(input.orderId, tx);
      const reuse = [...existing]
        .reverse()
        .find((row) =>
          [
            'REQUESTED',
            'UNDER_REVIEW',
            'APPROVED',
            'PROCESSING',
            'REFUNDED',
          ].includes(row.status),
        );
      if (!reuse) {
        throw orderCancellationRefundRequired(
          'Payment is fully reserved but no Refund row exists',
        );
      }
      if (reuse.amountMinor > locked.amountMinor) {
        throw orderCancellationRefundRequired(
          'Existing Refund amount exceeds Payment authority',
        );
      }
      return this.toIntentView(reuse, false);
    }

    try {
      const created = await this.refunds.createRefund(
        {
          orderId: input.orderId,
          paymentTransactionId: null,
          refundMethod: REFUND_METHOD_MANUAL_OTHER,
          amountMinor: capacity.remainingRefundableMinor,
          status: REFUND_STATUS_REQUESTED,
          reason: input.reason.slice(0, 255),
          internalNote: input.internalNote ?? null,
          requestOrigin: input.origin,
          requestedByAdminId: null,
          paidTerminalIntentKey: intentKey,
        },
        tx,
      );
      return this.toIntentView(created, true);
    } catch (error) {
      if (!isPostgresUniqueViolation(error)) {
        throw error;
      }
      const raced = await this.refunds.findByPaidTerminalIntentKey(
        intentKey,
        tx,
      );
      if (!raced) {
        throw orderCancellationRefundRequired(
          'Paid-terminal Refund unique conflict without reusable intent',
        );
      }
      this.requireCompatibleExistingIntent(raced, locked.amountMinor);
      return this.toIntentView(raced, false);
    }
  }

  toPublicRefundFields(intent: PaidTerminalRefundIntentView | null): {
    refundRequired: boolean;
    refundId: string | null;
    refundStatus: string | null;
    refundAmountMinor: string | null;
  } {
    if (!intent) {
      return {
        refundRequired: false,
        refundId: null,
        refundStatus: null,
        refundAmountMinor: null,
      };
    }
    return {
      refundRequired: true,
      refundId: intent.refundId,
      refundStatus: intent.refundStatus,
      refundAmountMinor: intent.refundAmountMinor,
    };
  }

  private requireCompatibleExistingIntent(
    existing: RefundRecord,
    paymentAmountMinor: number,
  ): void {
    if (!isPaidTerminalRefundOrigin(existing.requestOrigin)) {
      throw orderCancellationRefundRequired(
        'Existing paid-terminal intent key maps to a non-automatic Refund origin',
      );
    }
    if (existing.requestedByAdminId !== null) {
      throw orderCancellationRefundRequired(
        'Existing paid-terminal Refund must not carry an Admin actor',
      );
    }
    if (existing.amountMinor > paymentAmountMinor) {
      throw orderCancellationRefundRequired(
        'Existing paid-terminal Refund amount exceeds Payment authority',
      );
    }
  }

  private toIntentView(
    row: RefundRecord,
    created: boolean,
  ): PaidTerminalRefundIntentView {
    return {
      refundId: row.id,
      refundStatus: row.status,
      refundAmountMinor: moneyMinorToDecimalString(row.amountMinor),
      created,
      requestOrigin: row.requestOrigin,
    };
  }
}
