import { Injectable } from '@nestjs/common';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import {
  pgBigInt,
  pgChar,
  pgNow,
  pgVarchar,
} from '../../../infrastructure/database/pg-values';
import {
  ledgerFinancialStateInvalid,
  ledgerReferenceAmbiguous,
} from '../domain/financial-ledger.errors';
import {
  FINANCIAL_LEDGER_LOCK_CLASS_ID,
  ledgerAdvisoryObjectId,
  ledgerReferencePrefix,
} from '../domain/financial-ledger.policy';
import {
  LEDGER_CURRENCY_DZD,
  LEDGER_DIRECTION_CREDIT,
  LEDGER_DIRECTION_DEBIT,
  LEDGER_SOURCE_COD_COLLECTION,
  LEDGER_SOURCE_COD_REMITTANCE,
  LEDGER_SOURCE_DRIVER_EARNING,
  LEDGER_SOURCE_MERCHANT_SETTLEMENT,
  LEDGER_SOURCE_PAYMENT,
  LEDGER_SOURCE_REFUND,
  LEDGER_TYPE_COD_CUSTODY,
  LEDGER_TYPE_DRIVER_PAYABLE,
  LEDGER_TYPE_MERCHANT_PAYABLE,
  type FinancialLedgerEntryRecord,
  type LedgerDirection,
  type LedgerListQuery,
} from '../domain/financial-ledger.types';

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
  throw ledgerFinancialStateInvalid(
    'Ledger database query returned an unexpected result',
  );
}

function toEntry(row: {
  id: string;
  orderId: string | null;
  merchantId: string | null;
  driverId: string | null;
  type: string;
  direction: string;
  amountMinor: unknown;
  currency: string;
  reversalOfId: string | null;
  reference: string;
  createdAt: string;
}): FinancialLedgerEntryRecord {
  if (
    row.direction !== LEDGER_DIRECTION_DEBIT &&
    row.direction !== LEDGER_DIRECTION_CREDIT
  ) {
    throw ledgerFinancialStateInvalid('Persisted ledger direction is invalid');
  }
  return {
    id: row.id,
    orderId: row.orderId,
    merchantId: row.merchantId,
    driverId: row.driverId,
    type: row.type,
    direction: row.direction,
    amountMinor: Number(row.amountMinor),
    currency: row.currency,
    reversalOfId: row.reversalOfId,
    reference: row.reference,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class FinancialLedgerRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  runInTransaction<T>(fn: (tx: OrmClient) => Promise<T>): Promise<T> {
    return this.db().transaction(async (tx: OrmClient) => fn(tx));
  }

  asClient(client?: OrmClient): OrmClient {
    return client ?? this.db();
  }

  async lockReference(reference: string, client: OrmClient): Promise<void> {
    if (typeof client.query !== 'function') {
      return;
    }
    const objectId = ledgerAdvisoryObjectId(reference);
    const plan = this.db().raw.sql`
        SELECT 1::int4 AS locked
        WHERE (
          SELECT CASE
            WHEN pg_advisory_xact_lock(${FINANCIAL_LEDGER_LOCK_CLASS_ID}, ${objectId}) IS NULL
              THEN 1
            ELSE 1
          END
        ) = 1
      `
      .returnsRow({
        locked: 'pg/int4@1',
      })
      .build();
    await consumeQueryRows(client.query(plan));
  }

  async findByReference(
    reference: string,
    client?: OrmClient,
  ): Promise<FinancialLedgerEntryRecord | null> {
    const rows = await orm(this.asClient(client))
      .FinancialLedgerEntry.where({
        reference: pgVarchar<128>(reference),
      })
      .all();
    if (rows.length > 1) {
      throw ledgerReferenceAmbiguous(
        `Ambiguous ledger reference ${reference}: ${rows.length} rows`,
      );
    }
    return rows[0] ? toEntry(rows[0]) : null;
  }

  async createEntry(
    input: {
      orderId: string | null;
      merchantId: string | null;
      driverId: string | null;
      type: string;
      direction: LedgerDirection;
      amountMinor: number;
      currency: string;
      reference: string;
    },
    client: OrmClient,
  ): Promise<FinancialLedgerEntryRecord> {
    const id = createUuidV7();
    const now = pgNow();
    await orm(client).FinancialLedgerEntry.create({
      id,
      orderId: input.orderId,
      merchantId: input.merchantId,
      driverId: input.driverId,
      type: pgVarchar<64>(input.type),
      direction: input.direction,
      amountMinor: pgBigInt(input.amountMinor),
      currency: pgChar<3>(input.currency),
      reversalOfId: null,
      reference: pgVarchar<128>(input.reference),
      createdAt: now,
    });
    const row = await orm(client).FinancialLedgerEntry.where({ id }).first();
    if (!row) {
      throw new Error('FinancialLedgerEntry create failed');
    }
    return toEntry(row);
  }

  async list(
    query: LedgerListQuery,
  ): Promise<{ items: FinancialLedgerEntryRecord[]; total: number }> {
    const rows = await orm(this.db()).FinancialLedgerEntry.where({}).all();
    let filtered = rows.map(toEntry);
    if (query.type) {
      filtered = filtered.filter((row) => row.type === query.type);
    }
    if (query.direction) {
      filtered = filtered.filter((row) => row.direction === query.direction);
    }
    if (query.reference) {
      filtered = filtered.filter((row) => row.reference === query.reference);
    }
    if (query.orderId) {
      filtered = filtered.filter((row) => row.orderId === query.orderId);
    }
    if (query.merchantId) {
      filtered = filtered.filter((row) => row.merchantId === query.merchantId);
    }
    if (query.driverId) {
      filtered = filtered.filter((row) => row.driverId === query.driverId);
    }
    if (query.createdFrom) {
      filtered = filtered.filter((row) => row.createdAt >= query.createdFrom!);
    }
    if (query.createdTo) {
      filtered = filtered.filter((row) => row.createdAt < query.createdTo!);
    }
    filtered.sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
    );
    const total = filtered.length;
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;
    return {
      items: filtered.slice(offset, offset + limit),
      total,
    };
  }

  async sumDirectionForMerchant(
    merchantId: string,
    type: string,
    direction: LedgerDirection,
    client?: OrmClient,
  ): Promise<number> {
    const rows = await orm(this.asClient(client))
      .FinancialLedgerEntry.where({
        merchantId,
        type: pgVarchar<64>(type),
        direction,
      })
      .all();
    return rows.reduce((sum, row) => sum + Number(row.amountMinor), 0);
  }

  async sumDirectionForDriver(
    driverId: string,
    type: string,
    direction: LedgerDirection,
    client?: OrmClient,
  ): Promise<number> {
    const rows = await orm(this.asClient(client))
      .FinancialLedgerEntry.where({
        driverId,
        type: pgVarchar<64>(type),
        direction,
      })
      .all();
    return rows.reduce((sum, row) => sum + Number(row.amountMinor), 0);
  }

  async findUnpostedElectronicPayments(limit: number): Promise<
    Array<{
      paymentId: string;
      orderId: string;
      amountMinor: number;
      currency: string;
    }>
  > {
    const referencePrefix = ledgerReferencePrefix(LEDGER_SOURCE_PAYMENT);
    const plan = this.db().raw.sql`
        SELECT p.id AS payment_id, p.order_id, p.amount_minor, p.currency
        FROM payments p
        WHERE p.method = 'ELECTRONIC'
          AND p.status = 'SUCCEEDED'
          AND p.currency = ${LEDGER_CURRENCY_DZD}
          AND NOT EXISTS (
            SELECT 1 FROM financial_ledger_entries e
            WHERE e.reference = (${referencePrefix} || p.id::text)
          )
        ORDER BY p.updated_at ASC
        LIMIT ${limit}
      `
      .returnsRow({
        payment_id: 'pg/uuid@1',
        order_id: 'pg/uuid@1',
        amount_minor: 'pg/int8@1',
        currency: 'sql/varchar@1',
      })
      .build();
    const rows: Array<{
      payment_id: string;
      order_id: string;
      amount_minor: bigint | number | string;
      currency: string;
    }> = [];
    for await (const row of this.db().runtime().query(plan)) {
      rows.push(row);
    }
    return rows.map((row) => ({
      paymentId: row.payment_id,
      orderId: row.order_id,
      amountMinor: Number(row.amount_minor),
      currency: String(row.currency),
    }));
  }

  async findUnpostedCodCollections(limit: number): Promise<
    Array<{
      collectionId: string;
      orderId: string;
      driverId: string;
      amountMinor: number;
    }>
  > {
    const referencePrefix = ledgerReferencePrefix(LEDGER_SOURCE_COD_COLLECTION);
    const plan = this.db().raw.sql`
        SELECT c.id AS collection_id, c.order_id, c.driver_id, c.collected_amount_minor
        FROM cod_collections c
        WHERE c.status = 'COLLECTED'
          AND NOT EXISTS (
            SELECT 1 FROM financial_ledger_entries e
            WHERE e.reference = (${referencePrefix} || c.id::text)
          )
        ORDER BY c.collected_at ASC
        LIMIT ${limit}
      `
      .returnsRow({
        collection_id: 'pg/uuid@1',
        order_id: 'pg/uuid@1',
        driver_id: 'pg/uuid@1',
        collected_amount_minor: 'pg/int8@1',
      })
      .build();
    const rows: Array<{
      collection_id: string;
      order_id: string;
      driver_id: string;
      collected_amount_minor: bigint | number | string;
    }> = [];
    for await (const row of this.db().runtime().query(plan)) {
      rows.push(row);
    }
    return rows.map((row) => ({
      collectionId: row.collection_id,
      orderId: row.order_id,
      driverId: row.driver_id,
      amountMinor: Number(row.collected_amount_minor),
    }));
  }

  async findUnpostedCodRemittances(limit: number): Promise<
    Array<{
      remittanceId: string;
      driverId: string;
      amountMinor: number;
    }>
  > {
    const referencePrefix = ledgerReferencePrefix(LEDGER_SOURCE_COD_REMITTANCE);
    const plan = this.db().raw.sql`
        SELECT r.id AS remittance_id, r.driver_id, r.confirmed_amount_minor
        FROM cod_remittances r
        WHERE r.status = 'CONFIRMED'
          AND NOT EXISTS (
            SELECT 1 FROM financial_ledger_entries e
            WHERE e.reference = (${referencePrefix} || r.id::text)
          )
        ORDER BY r.confirmed_at ASC NULLS LAST
        LIMIT ${limit}
      `
      .returnsRow({
        remittance_id: 'pg/uuid@1',
        driver_id: 'pg/uuid@1',
        confirmed_amount_minor: 'pg/int8@1',
      })
      .build();
    const rows: Array<{
      remittance_id: string;
      driver_id: string;
      confirmed_amount_minor: bigint | number | string;
    }> = [];
    for await (const row of this.db().runtime().query(plan)) {
      rows.push(row);
    }
    return rows.map((row) => ({
      remittanceId: row.remittance_id,
      driverId: row.driver_id,
      amountMinor: Number(row.confirmed_amount_minor),
    }));
  }

  async findUnpostedDriverEarnings(limit: number): Promise<
    Array<{
      earningId: string;
      deliveryId: string;
      driverId: string;
      orderId: string;
      amountMinor: number;
    }>
  > {
    const referencePrefix = ledgerReferencePrefix(LEDGER_SOURCE_DRIVER_EARNING);
    const plan = this.db().raw.sql`
        SELECT e.id AS earning_id, e.delivery_id, e.driver_id, d.order_id, e.net_earning_minor
        FROM driver_earnings e
        INNER JOIN deliveries d ON d.id = e.delivery_id
        WHERE e.status = 'EARNED'
          AND NOT EXISTS (
            SELECT 1 FROM financial_ledger_entries l
            WHERE l.reference = (${referencePrefix} || e.id::text)
          )
        ORDER BY e.created_at ASC
        LIMIT ${limit}
      `
      .returnsRow({
        earning_id: 'pg/uuid@1',
        delivery_id: 'pg/uuid@1',
        driver_id: 'pg/uuid@1',
        order_id: 'pg/uuid@1',
        net_earning_minor: 'pg/int8@1',
      })
      .build();
    const rows: Array<{
      earning_id: string;
      delivery_id: string;
      driver_id: string;
      order_id: string;
      net_earning_minor: bigint | number | string;
    }> = [];
    for await (const row of this.db().runtime().query(plan)) {
      rows.push(row);
    }
    return rows.map((row) => ({
      earningId: row.earning_id,
      deliveryId: row.delivery_id,
      driverId: row.driver_id,
      orderId: row.order_id,
      amountMinor: Number(row.net_earning_minor),
    }));
  }

  async findUnpostedRefunds(limit: number): Promise<
    Array<{
      refundId: string;
      orderId: string;
      amountMinor: number;
    }>
  > {
    const referencePrefix = ledgerReferencePrefix(LEDGER_SOURCE_REFUND);
    const plan = this.db().raw.sql`
        SELECT r.id AS refund_id, r.order_id, r.amount_minor
        FROM refunds r
        WHERE r.status = 'REFUNDED'
          AND NOT EXISTS (
            SELECT 1 FROM financial_ledger_entries e
            WHERE e.reference = (${referencePrefix} || r.id::text)
          )
        ORDER BY r.completed_at ASC NULLS LAST
        LIMIT ${limit}
      `
      .returnsRow({
        refund_id: 'pg/uuid@1',
        order_id: 'pg/uuid@1',
        amount_minor: 'pg/int8@1',
      })
      .build();
    const rows: Array<{
      refund_id: string;
      order_id: string;
      amount_minor: bigint | number | string;
    }> = [];
    for await (const row of this.db().runtime().query(plan)) {
      rows.push(row);
    }
    return rows.map((row) => ({
      refundId: row.refund_id,
      orderId: row.order_id,
      amountMinor: Number(row.amount_minor),
    }));
  }

  async findUnpostedMerchantSettlements(limit: number): Promise<
    Array<{
      settlementId: string;
      merchantId: string;
      netPayableMinor: number;
    }>
  > {
    const referencePrefix = ledgerReferencePrefix(
      LEDGER_SOURCE_MERCHANT_SETTLEMENT,
    );
    const plan = this.db().raw.sql`
        SELECT s.id AS settlement_id, s.merchant_id, s.net_payable_minor
        FROM merchant_settlements s
        WHERE s.status = 'FINALIZED'
          AND NOT EXISTS (
            SELECT 1 FROM financial_ledger_entries e
            WHERE e.reference = (${referencePrefix} || s.id::text)
          )
        ORDER BY s.created_at ASC
        LIMIT ${limit}
      `
      .returnsRow({
        settlement_id: 'pg/uuid@1',
        merchant_id: 'pg/uuid@1',
        net_payable_minor: 'pg/int8@1',
      })
      .build();
    const rows: Array<{
      settlement_id: string;
      merchant_id: string;
      net_payable_minor: bigint | number | string;
    }> = [];
    for await (const row of this.db().runtime().query(plan)) {
      rows.push(row);
    }
    return rows.map((row) => ({
      settlementId: row.settlement_id,
      merchantId: row.merchant_id,
      netPayableMinor: Number(row.net_payable_minor),
    }));
  }

  /** Exported for balance helpers. */
  merchantPayableType(): string {
    return LEDGER_TYPE_MERCHANT_PAYABLE;
  }

  driverPayableType(): string {
    return LEDGER_TYPE_DRIVER_PAYABLE;
  }

  codCustodyType(): string {
    return LEDGER_TYPE_COD_CUSTODY;
  }
}
