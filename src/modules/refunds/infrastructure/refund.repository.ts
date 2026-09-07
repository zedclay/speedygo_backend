import { Injectable } from '@nestjs/common';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import {
  pgBigInt,
  pgNow,
  pgVarchar,
} from '../../../infrastructure/database/pg-values';
import { parseMinorUnits } from '../../catalog/domain/catalog.policy';
import { PAYMENT_TX_SUCCEEDED } from '../../payments/domain/payment.policy';
import { parseRefundAmountMinor } from '../domain/refund.policy';
import {
  REFUND_CURRENCY_DZD,
  REFUND_REQUEST_ORIGINS,
  REFUND_STATUS_REFUNDED,
  type RefundFinancialContext,
  type RefundMethod,
  type RefundRecord,
  type RefundRequestOrigin,
  type RefundStatus,
} from '../domain/refund.types';
import { isRefundMethod, isRefundStatus } from '../domain/refund.policy';

export type OrmClient = { orm: SpeedyGoDb['orm'] };

function orm(client: OrmClient) {
  return client.orm.public;
}

function isRefundRequestOrigin(value: string): value is RefundRequestOrigin {
  return (REFUND_REQUEST_ORIGINS as readonly string[]).includes(value);
}

function toRefund(row: {
  id: string;
  orderId: string;
  paymentTransactionId: string | null;
  refundMethod: string;
  amountMinor: unknown;
  status: string;
  reason: string;
  internalNote: string | null;
  requestOrigin: string;
  requestedByAdminId: string | null;
  paidTerminalIntentKey: string | null;
  requestedAt: string;
  completedAt: string | null;
  createdAt: string;
}): RefundRecord {
  if (
    !isRefundMethod(row.refundMethod) ||
    !isRefundStatus(row.status) ||
    !isRefundRequestOrigin(row.requestOrigin)
  ) {
    throw new Error('Persisted Refund has invalid method, status, or origin');
  }
  return {
    id: row.id,
    orderId: row.orderId,
    paymentTransactionId: row.paymentTransactionId,
    refundMethod: row.refundMethod,
    amountMinor: parseRefundAmountMinor(row.amountMinor),
    status: row.status,
    reason: row.reason,
    internalNote: row.internalNote,
    requestOrigin: row.requestOrigin,
    requestedByAdminId: row.requestedByAdminId,
    paidTerminalIntentKey: row.paidTerminalIntentKey,
    requestedAt: row.requestedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class RefundRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  runInTransaction<T>(fn: (tx: OrmClient) => Promise<T>): Promise<T> {
    return this.db().transaction(fn);
  }

  async adminExists(adminId: string, client?: OrmClient): Promise<boolean> {
    const row = await orm(client ?? this.db())
      .AdminProfile.where({ id: adminId })
      .first();
    return Boolean(row);
  }

  async findCustomerIdByAccountId(accountId: string): Promise<string | null> {
    const row = await orm(this.db())
      .CustomerProfile.where({ accountId })
      .first();
    return row?.id ?? null;
  }

  async findFinancialContextByOrderId(
    orderId: string,
    client?: OrmClient,
  ): Promise<RefundFinancialContext | null> {
    const db = client ?? this.db();
    const order = await orm(db).Order.where({ id: orderId }).first();
    if (!order) {
      return null;
    }
    const payment = await orm(db).Payment.where({ orderId }).first();
    const snapshot = await orm(db)
      .OrderFinancialSnapshot.where({ orderId })
      .first();
    if (!payment || !snapshot) {
      return null;
    }
    return {
      orderId: order.id,
      orderStatus: order.status,
      customerId: order.customerId,
      paymentId: payment.id,
      paymentMethod: payment.method,
      paymentStatus: payment.status,
      paymentAmountMinor: parseRefundAmountMinor(payment.amountMinor),
      paymentCurrency: payment.currency,
      snapshotPayableMinor: parseRefundAmountMinor(
        snapshot.customerPayableMinor,
      ),
      snapshotCurrency: snapshot.currency,
    };
  }

  async lockPayment(
    paymentId: string,
    client: OrmClient,
  ): Promise<{
    id: string;
    orderId: string;
    method: string;
    status: string;
    amountMinor: bigint;
    currency: string;
  } | null> {
    await orm(client).Payment.where({ id: paymentId }).update({
      updatedAt: pgNow(),
    });
    const row = await orm(client).Payment.where({ id: paymentId }).first();
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      orderId: row.orderId,
      method: row.method,
      status: row.status,
      amountMinor: parseRefundAmountMinor(row.amountMinor),
      currency: row.currency,
    };
  }

  async sumReservedAndSuccessful(
    orderId: string,
    client?: OrmClient,
  ): Promise<{ reservedRefundMinor: bigint; successfulRefundMinor: bigint }> {
    if (client) {
      const rows = await orm(client).Refund.where({ orderId }).all();
      let reservedRefundMinor = 0n;
      let successfulRefundMinor = 0n;
      for (const row of rows) {
        const amount = parseRefundAmountMinor(row.amountMinor);
        if (
          row.status === 'REQUESTED' ||
          row.status === 'UNDER_REVIEW' ||
          row.status === 'APPROVED' ||
          row.status === 'PROCESSING' ||
          row.status === REFUND_STATUS_REFUNDED
        ) {
          reservedRefundMinor += amount;
        }
        if (row.status === REFUND_STATUS_REFUNDED) {
          successfulRefundMinor += amount;
        }
      }
      return { reservedRefundMinor, successfulRefundMinor };
    }

    const plan = this.db().raw.sql`
        SELECT
          COALESCE(
            SUM(amount_minor) FILTER (
              WHERE status IN (
                'REQUESTED',
                'UNDER_REVIEW',
                'APPROVED',
                'PROCESSING',
                'REFUNDED'
              )
            ),
            0
          )::bigint AS reserved_refund_minor,
          COALESCE(
            SUM(amount_minor) FILTER (WHERE status = ${REFUND_STATUS_REFUNDED}),
            0
          )::bigint AS successful_refund_minor
        FROM refunds
        WHERE order_id = ${orderId}::uuid
      `
      .returnsRow({
        reserved_refund_minor: 'pg/int8@1',
        successful_refund_minor: 'pg/int8@1',
      })
      .build();

    const rows: Array<{
      reserved_refund_minor: bigint | string | number;
      successful_refund_minor: bigint | string | number;
    }> = [];
    for await (const row of this.db().runtime().query(plan)) {
      rows.push(row);
    }
    const row = rows[0];
    return {
      reservedRefundMinor: parseRefundAmountMinor(
        row?.reserved_refund_minor ?? 0n,
      ),
      successfulRefundMinor: parseRefundAmountMinor(
        row?.successful_refund_minor ?? 0n,
      ),
    };
  }

  async findSucceededPaymentTransaction(
    paymentId: string,
    client?: OrmClient,
  ): Promise<{
    id: string;
    providerReference: string | null;
    status: string;
    amountMinor: number;
  } | null> {
    const rows = await orm(client ?? this.db())
      .PaymentTransaction.where({ paymentId })
      .all();
    const succeeded = rows
      .filter((row) => row.status === PAYMENT_TX_SUCCEEDED)
      .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1));
    const row = succeeded[0];
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      providerReference: row.providerReference,
      status: row.status,
      amountMinor: parseMinorUnits(row.amountMinor),
    };
  }

  async findPaymentTransactionForPayment(
    paymentId: string,
    paymentTransactionId: string,
    client?: OrmClient,
  ): Promise<{
    id: string;
    providerReference: string | null;
    status: string;
    amountMinor: number;
  } | null> {
    const row = await orm(client ?? this.db())
      .PaymentTransaction.where({ id: paymentTransactionId, paymentId })
      .first();
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      providerReference: row.providerReference,
      status: row.status,
      amountMinor: parseMinorUnits(row.amountMinor),
    };
  }

  async createRefund(
    input: {
      orderId: string;
      paymentTransactionId: string | null;
      refundMethod: RefundMethod;
      amountMinor: number | bigint;
      status: RefundStatus;
      reason: string;
      internalNote: string | null;
      requestOrigin: RefundRequestOrigin;
      requestedByAdminId: string | null;
      paidTerminalIntentKey: string | null;
    },
    client: OrmClient,
  ): Promise<RefundRecord> {
    const id = createUuidV7();
    const now = pgNow();
    await orm(client).Refund.create({
      id,
      orderId: input.orderId,
      paymentTransactionId: input.paymentTransactionId,
      refundMethod: input.refundMethod,
      amountMinor: pgBigInt(input.amountMinor),
      status: input.status,
      reason: pgVarchar<255>(input.reason),
      internalNote: input.internalNote,
      requestOrigin: input.requestOrigin,
      requestedByAdminId: input.requestedByAdminId,
      paidTerminalIntentKey: input.paidTerminalIntentKey
        ? pgVarchar<128>(input.paidTerminalIntentKey)
        : null,
      requestedAt: now,
      completedAt: null,
      createdAt: now,
    });
    const row = await orm(client).Refund.where({ id }).first();
    if (!row) {
      throw new Error('Refund create did not persist');
    }
    return toRefund(row);
  }

  async findByPaidTerminalIntentKey(
    paidTerminalIntentKey: string,
    client?: OrmClient,
  ): Promise<RefundRecord | null> {
    const row = await orm(client ?? this.db())
      .Refund.where({
        paidTerminalIntentKey: pgVarchar<128>(paidTerminalIntentKey),
      })
      .first();
    return row ? toRefund(row) : null;
  }

  async findById(
    refundId: string,
    client?: OrmClient,
  ): Promise<RefundRecord | null> {
    const row = await orm(client ?? this.db())
      .Refund.where({ id: refundId })
      .first();
    return row ? toRefund(row) : null;
  }

  async updateStatus(
    input: {
      refundId: string;
      status: RefundStatus;
      /** When set, update only if current status is one of these (concurrency safety). */
      fromStatuses?: readonly RefundStatus[];
      setCompletedAt?: boolean;
      clearCompletedAt?: boolean;
      internalNote?: string | null;
    },
    client: OrmClient,
  ): Promise<RefundRecord | null> {
    const patch: Record<string, unknown> = { status: input.status };
    if (input.setCompletedAt) {
      patch.completedAt = pgNow();
    }
    if (input.clearCompletedAt) {
      patch.completedAt = null;
    }
    if (input.internalNote !== undefined) {
      patch.internalNote = input.internalNote;
    }

    if (input.fromStatuses && input.fromStatuses.length > 0) {
      const current = await this.findById(input.refundId, client);
      if (!current) {
        return null;
      }
      if (!(input.fromStatuses as readonly string[]).includes(current.status)) {
        return current;
      }
      await orm(client)
        .Refund.where({ id: input.refundId, status: current.status })
        .update(patch);
    } else {
      await orm(client).Refund.where({ id: input.refundId }).update(patch);
    }
    return this.findById(input.refundId, client);
  }

  async listByOrderId(
    orderId: string,
    client?: OrmClient,
  ): Promise<RefundRecord[]> {
    const rows = await orm(client ?? this.db())
      .Refund.where({ orderId })
      .all();
    return rows
      .map(toRefund)
      .sort((left, right) =>
        left.requestedAt < right.requestedAt
          ? -1
          : left.requestedAt > right.requestedAt
            ? 1
            : 0,
      );
  }

  async countMerchantSettlementsForOrder(orderId: string): Promise<number> {
    const rows = await orm(this.db())
      .MerchantSettlementLine.where({ orderId })
      .all();
    return rows.length;
  }

  async findPaymentImmutableState(orderId: string): Promise<{
    status: string;
    amountMinor: number;
    currency: string;
  } | null> {
    const row = await orm(this.db()).Payment.where({ orderId }).first();
    if (!row) {
      return null;
    }
    return {
      status: row.status,
      amountMinor: parseMinorUnits(row.amountMinor),
      currency: row.currency,
    };
  }

  async findOrderStatus(
    orderId: string,
    client?: OrmClient,
  ): Promise<string | null> {
    const row = await orm(client ?? this.db())
      .Order.where({ id: orderId })
      .first();
    return row?.status ?? null;
  }

  async findSnapshotFingerprint(orderId: string): Promise<{
    customerPayableMinor: number;
    merchantCommissionAmountMinor: number;
    merchantNetAmountMinor: number;
    driverRemunerationMinor: number;
  } | null> {
    const row = await orm(this.db())
      .OrderFinancialSnapshot.where({ orderId })
      .first();
    if (!row) {
      return null;
    }
    return {
      customerPayableMinor: parseMinorUnits(row.customerPayableMinor),
      merchantCommissionAmountMinor: parseMinorUnits(
        row.merchantCommissionAmountMinor,
      ),
      merchantNetAmountMinor: parseMinorUnits(row.merchantNetAmountMinor),
      driverRemunerationMinor: parseMinorUnits(row.driverRemunerationMinor),
    };
  }

  currencyLabel(): string {
    return REFUND_CURRENCY_DZD;
  }
}
