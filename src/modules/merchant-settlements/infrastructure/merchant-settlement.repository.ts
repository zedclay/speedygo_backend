import { Injectable } from '@nestjs/common';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import {
  pgBigInt,
  pgNow,
  pgTimestamptz,
  pgVarchar,
} from '../../../infrastructure/database/pg-values';
import { parseMinorUnits } from '../../catalog/domain/catalog.policy';
import { merchantSettlementFinancialStateInvalid } from '../domain/merchant-settlement.errors';
import {
  MERCHANT_SETTLEMENT_LOCK_CLASS_ID,
  isSettlementStatus,
  merchantSettlementAdvisoryObjectId,
} from '../domain/merchant-settlement.policy';
import {
  SETTLEMENT_LINE_TYPE_REFUND_ADJUSTMENT,
  SETTLEMENT_LINE_TYPE_SALE,
  SETTLEMENT_STATUS_DRAFT,
  SETTLEMENT_STATUS_FINALIZED,
  type MerchantSettlementLineRecord,
  type MerchantSettlementRecord,
  type SettlementLineTypeV1,
  type SettlementTotals,
} from '../domain/merchant-settlement.types';

export type OrmClient = {
  orm: SpeedyGoDb['orm'];
  query?: (plan: unknown) => unknown;
};

function orm(client: OrmClient) {
  return client.orm.public;
}

async function consumeQueryRows<T>(result: unknown): Promise<T[]> {
  if (Array.isArray(result)) {
    return result as T[];
  }
  if (
    result != null &&
    typeof (result as Promise<unknown>).then === 'function'
  ) {
    return consumeQueryRows(await (result as Promise<unknown>));
  }
  if (
    result != null &&
    typeof result === 'object' &&
    Symbol.asyncIterator in result
  ) {
    const rows: T[] = [];
    for await (const row of result as AsyncIterable<T>) {
      rows.push(row);
    }
    return rows;
  }
  throw merchantSettlementFinancialStateInvalid(
    'Settlement database query returned an unexpected result',
  );
}

function toSettlement(row: {
  id: string;
  merchantId: string;
  periodStart: string;
  periodEnd: string;
  grossSalesMinor: unknown;
  commissionMinor: unknown;
  refundAdjustmentsMinor: unknown;
  manualAdjustmentsMinor: unknown;
  netPayableMinor: unknown;
  status: string;
  paidAt: string | null;
  createdAt: string;
}): MerchantSettlementRecord {
  if (!isSettlementStatus(row.status)) {
    throw merchantSettlementFinancialStateInvalid(
      'Persisted settlement status is unsupported',
    );
  }
  return {
    id: row.id,
    merchantId: row.merchantId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    grossSalesMinor: parseMinorUnits(row.grossSalesMinor),
    commissionMinor: parseMinorUnits(row.commissionMinor),
    refundAdjustmentsMinor: Number(row.refundAdjustmentsMinor),
    manualAdjustmentsMinor: Number(row.manualAdjustmentsMinor),
    netPayableMinor: Number(row.netPayableMinor),
    status: row.status,
    paidAt: row.paidAt,
    createdAt: row.createdAt,
  };
}

function toLine(row: {
  id: string;
  settlementId: string;
  orderId: string | null;
  type: string;
  grossMerchandiseMinor: unknown;
  commissionMinor: unknown;
  merchantNetMinor: unknown;
  adjustmentMinor: unknown;
  reference: string | null;
  createdAt: string;
}): MerchantSettlementLineRecord {
  if (
    row.type !== SETTLEMENT_LINE_TYPE_SALE &&
    row.type !== SETTLEMENT_LINE_TYPE_REFUND_ADJUSTMENT
  ) {
    throw merchantSettlementFinancialStateInvalid(
      'Persisted settlement line type is unsupported in v1.0',
    );
  }
  return {
    id: row.id,
    settlementId: row.settlementId,
    orderId: row.orderId,
    type: row.type,
    grossMerchandiseMinor: parseMinorUnits(row.grossMerchandiseMinor),
    commissionMinor: parseMinorUnits(row.commissionMinor),
    merchantNetMinor: Number(row.merchantNetMinor),
    adjustmentMinor: Number(row.adjustmentMinor),
    reference: row.reference,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class MerchantSettlementRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  runInTransaction<T>(fn: (tx: OrmClient) => Promise<T>): Promise<T> {
    return this.db().transaction(async (tx: OrmClient) => fn(tx));
  }

  async adminExists(adminId: string, client?: OrmClient): Promise<boolean> {
    const row = await orm(client ?? this.db())
      .AdminProfile.where({ id: adminId })
      .first();
    return Boolean(row);
  }

  async merchantExists(
    merchantId: string,
    client?: OrmClient,
  ): Promise<boolean> {
    const row = await orm(client ?? this.db())
      .Merchant.where({ id: merchantId })
      .first();
    return Boolean(row);
  }

  async lockMerchantScope(
    merchantId: string,
    client: OrmClient,
  ): Promise<void> {
    const objectId = merchantSettlementAdvisoryObjectId(merchantId);
    const plan = this.db().raw.sql`
        SELECT 1::int4 AS locked
        WHERE (
          SELECT CASE
            WHEN pg_advisory_xact_lock(${MERCHANT_SETTLEMENT_LOCK_CLASS_ID}, ${objectId}) IS NULL
              THEN 1
            ELSE 1
          END
        ) = 1
      `
      .returnsRow({
        locked: 'pg/int4@1',
      })
      .build();
    await this.queryOnClient(client, plan);
  }

  private async queryOnClient<T>(
    client: OrmClient,
    plan: unknown,
  ): Promise<T[]> {
    if (typeof client.query !== 'function') {
      throw merchantSettlementFinancialStateInvalid(
        'Settlement requires a transactional database client',
      );
    }
    return consumeQueryRows<T>(client.query(plan));
  }

  async findById(
    settlementId: string,
    client?: OrmClient,
  ): Promise<MerchantSettlementRecord | null> {
    const row = await orm(client ?? this.db())
      .MerchantSettlement.where({ id: settlementId })
      .first();
    return row ? toSettlement(row) : null;
  }

  async findOpenDraft(
    merchantId: string,
    client?: OrmClient,
  ): Promise<MerchantSettlementRecord | null> {
    const rows = await orm(client ?? this.db())
      .MerchantSettlement.where({
        merchantId,
        status: pgVarchar<64>(SETTLEMENT_STATUS_DRAFT),
      })
      .all();
    return rows[0] ? toSettlement(rows[0]) : null;
  }

  async listByMerchant(
    merchantId: string,
  ): Promise<MerchantSettlementRecord[]> {
    const rows = await orm(this.db())
      .MerchantSettlement.where({ merchantId })
      .all();
    return rows
      .map(toSettlement)
      .sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1));
  }

  async createDraft(
    input: {
      merchantId: string;
      periodStart: string;
      periodEnd: string;
    },
    client: OrmClient,
  ): Promise<MerchantSettlementRecord> {
    const id = createUuidV7();
    const now = pgNow();
    await orm(client).MerchantSettlement.create({
      id,
      merchantId: input.merchantId,
      periodStart: pgTimestamptz(input.periodStart),
      periodEnd: pgTimestamptz(input.periodEnd),
      grossSalesMinor: pgBigInt(0),
      commissionMinor: pgBigInt(0),
      refundAdjustmentsMinor: pgBigInt(0),
      manualAdjustmentsMinor: pgBigInt(0),
      netPayableMinor: pgBigInt(0),
      status: pgVarchar<64>(SETTLEMENT_STATUS_DRAFT),
      paidAt: null,
      createdAt: now,
    });
    const row = await orm(client).MerchantSettlement.where({ id }).first();
    if (!row) {
      throw new Error('MerchantSettlement create failed');
    }
    return toSettlement(row);
  }

  async updateDraftTotals(
    settlementId: string,
    totals: SettlementTotals,
    client: OrmClient,
  ): Promise<void> {
    await orm(client)
      .MerchantSettlement.where({
        id: settlementId,
        status: pgVarchar<64>(SETTLEMENT_STATUS_DRAFT),
      })
      .update({
        grossSalesMinor: pgBigInt(totals.grossSalesMinor),
        commissionMinor: pgBigInt(totals.commissionMinor),
        refundAdjustmentsMinor: pgBigInt(totals.refundAdjustmentsMinor),
        manualAdjustmentsMinor: pgBigInt(totals.manualAdjustmentsMinor),
        netPayableMinor: pgBigInt(totals.netPayableMinor),
      });
  }

  async finalize(
    settlementId: string,
    totals: SettlementTotals,
    client: OrmClient,
  ): Promise<MerchantSettlementRecord | null> {
    await orm(client)
      .MerchantSettlement.where({
        id: settlementId,
        status: pgVarchar<64>(SETTLEMENT_STATUS_DRAFT),
      })
      .update({
        grossSalesMinor: pgBigInt(totals.grossSalesMinor),
        commissionMinor: pgBigInt(totals.commissionMinor),
        refundAdjustmentsMinor: pgBigInt(totals.refundAdjustmentsMinor),
        manualAdjustmentsMinor: pgBigInt(totals.manualAdjustmentsMinor),
        netPayableMinor: pgBigInt(totals.netPayableMinor),
        status: pgVarchar<64>(SETTLEMENT_STATUS_FINALIZED),
      });
    return this.findById(settlementId, client);
  }

  async listLines(
    settlementId: string,
    client?: OrmClient,
  ): Promise<MerchantSettlementLineRecord[]> {
    const rows = await orm(client ?? this.db())
      .MerchantSettlementLine.where({ settlementId })
      .all();
    return rows
      .map(toLine)
      .sort((a, b) =>
        a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
      );
  }

  async findSaleLineByOrderId(
    orderId: string,
    client?: OrmClient,
  ): Promise<MerchantSettlementLineRecord | null> {
    const rows = await orm(client ?? this.db())
      .MerchantSettlementLine.where({
        orderId,
        type: SETTLEMENT_LINE_TYPE_SALE,
      })
      .all();
    return rows[0] ? toLine(rows[0]) : null;
  }

  async findRefundAdjustmentByRefundId(
    refundId: string,
    client?: OrmClient,
  ): Promise<MerchantSettlementLineRecord | null> {
    const rows = await orm(client ?? this.db())
      .MerchantSettlementLine.where({
        type: SETTLEMENT_LINE_TYPE_REFUND_ADJUSTMENT,
        reference: pgVarchar<128>(refundId),
      })
      .all();
    return rows[0] ? toLine(rows[0]) : null;
  }

  async createLine(
    input: {
      settlementId: string;
      orderId: string | null;
      type: SettlementLineTypeV1;
      grossMerchandiseMinor: number;
      commissionMinor: number;
      merchantNetMinor: number;
      adjustmentMinor: number;
      reference: string | null;
    },
    client: OrmClient,
  ): Promise<MerchantSettlementLineRecord> {
    const id = createUuidV7();
    const now = pgNow();
    await orm(client).MerchantSettlementLine.create({
      id,
      settlementId: input.settlementId,
      orderId: input.orderId,
      type: input.type,
      grossMerchandiseMinor: pgBigInt(input.grossMerchandiseMinor),
      commissionMinor: pgBigInt(input.commissionMinor),
      merchantNetMinor: pgBigInt(input.merchantNetMinor),
      adjustmentMinor: pgBigInt(input.adjustmentMinor),
      reference: input.reference ? pgVarchar<128>(input.reference) : null,
      createdAt: now,
    });
    const row = await orm(client).MerchantSettlementLine.where({ id }).first();
    if (!row) {
      throw new Error('MerchantSettlementLine create failed');
    }
    return toLine(row);
  }

  async findEligibleSaleOrders(
    input: {
      merchantId: string;
      periodStart: string;
      periodEnd: string;
    },
    client?: OrmClient,
  ): Promise<
    Array<{
      orderId: string;
      completedAt: string;
      grossMerchandiseSubtotalMinor: number;
      merchantCommissionAmountMinor: number;
      merchantNetAmountMinor: number;
      paymentStatus: string;
      orderStatus: string;
    }>
  > {
    const plan = this.db().raw.sql`
        SELECT
          o.id AS order_id,
          o.completed_at,
          o.status AS order_status,
          p.status AS payment_status,
          s.gross_merchandise_subtotal_minor,
          s.merchant_commission_amount_minor,
          s.merchant_net_amount_minor
        FROM orders o
        INNER JOIN merchant_branches b ON b.id = o.merchant_branch_id
        INNER JOIN payments p ON p.order_id = o.id
        INNER JOIN order_financial_snapshots s ON s.order_id = o.id
        WHERE b.merchant_id = ${input.merchantId}::uuid
          AND o.status = 'COMPLETED'
          AND p.status = 'SUCCEEDED'
          AND o.completed_at IS NOT NULL
          AND o.completed_at >= ${input.periodStart}::timestamptz
          AND o.completed_at < ${input.periodEnd}::timestamptz
          AND NOT EXISTS (
            SELECT 1
            FROM merchant_settlement_lines l
            WHERE l.order_id = o.id
              AND l.type = 'SALE'
          )
        ORDER BY o.completed_at ASC
      `
      .returnsRow({
        order_id: 'pg/uuid@1',
        completed_at: 'pg/timestamptz-string@1',
        order_status: 'sql/varchar@1',
        payment_status: 'sql/varchar@1',
        gross_merchandise_subtotal_minor: 'pg/int8@1',
        merchant_commission_amount_minor: 'pg/int8@1',
        merchant_net_amount_minor: 'pg/int8@1',
      })
      .build();

    type Row = {
      order_id: string;
      completed_at: string;
      order_status: string;
      payment_status: string;
      gross_merchandise_subtotal_minor: bigint | string | number;
      merchant_commission_amount_minor: bigint | string | number;
      merchant_net_amount_minor: bigint | string | number;
    };

    let rows: Row[];
    if (client) {
      rows = await this.queryOnClient<Row>(client, plan);
    } else {
      rows = [];
      for await (const row of this.db().runtime().query(plan)) {
        rows.push(row);
      }
    }

    return rows.map((row) => ({
      orderId: row.order_id,
      completedAt: String(row.completed_at),
      orderStatus: String(row.order_status),
      paymentStatus: String(row.payment_status),
      grossMerchandiseSubtotalMinor: Number(
        row.gross_merchandise_subtotal_minor,
      ),
      merchantCommissionAmountMinor: Number(
        row.merchant_commission_amount_minor,
      ),
      merchantNetAmountMinor: Number(row.merchant_net_amount_minor),
    }));
  }

  async findOrderSettlementContext(
    orderId: string,
    client?: OrmClient,
  ): Promise<{
    orderId: string;
    merchantId: string;
    orderStatus: string;
    completedAt: string | null;
    paymentStatus: string;
    grossMerchandiseSubtotalMinor: number;
    merchantCommissionAmountMinor: number;
    merchantNetAmountMinor: number;
  } | null> {
    const db = client ?? this.db();
    const order = await orm(db).Order.where({ id: orderId }).first();
    if (!order) {
      return null;
    }
    const branch = await orm(db)
      .MerchantBranch.where({ id: order.merchantBranchId })
      .first();
    if (!branch) {
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
      merchantId: branch.merchantId,
      orderStatus: order.status,
      completedAt: order.completedAt,
      paymentStatus: payment.status,
      grossMerchandiseSubtotalMinor: parseMinorUnits(
        snapshot.grossMerchandiseSubtotalMinor,
      ),
      merchantCommissionAmountMinor: parseMinorUnits(
        snapshot.merchantCommissionAmountMinor,
      ),
      merchantNetAmountMinor: parseMinorUnits(snapshot.merchantNetAmountMinor),
    };
  }

  async findRefundSettlementContext(
    refundId: string,
    client?: OrmClient,
  ): Promise<{
    refundId: string;
    orderId: string;
    status: string;
    amountMinor: number;
    completedAt: string | null;
    merchantId: string;
  } | null> {
    const db = client ?? this.db();
    const refund = await orm(db).Refund.where({ id: refundId }).first();
    if (!refund) {
      return null;
    }
    const orderCtx = await this.findOrderSettlementContext(refund.orderId, db);
    if (!orderCtx) {
      return null;
    }
    return {
      refundId: refund.id,
      orderId: refund.orderId,
      status: refund.status,
      amountMinor: parseMinorUnits(refund.amountMinor),
      completedAt: refund.completedAt,
      merchantId: orderCtx.merchantId,
    };
  }
}
