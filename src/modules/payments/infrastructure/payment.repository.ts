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
import {
  PAYMENT_STATUS_PENDING,
  PAYMENT_STATUS_PROCESSING,
  PAYMENT_STATUS_SUCCEEDED,
} from '../../orders/domain/order.policy';
import { isOpenAttemptStatus } from '../domain/payment.policy';
import type {
  PaymentRecord,
  PaymentTransactionRecord,
} from '../domain/payment.types';

export type OrmClient = { orm: SpeedyGoDb['orm'] };

function orm(client: OrmClient) {
  return client.orm.public;
}

function toPayment(row: {
  id: string;
  orderId: string;
  method: string;
  status: string;
  amountMinor: unknown;
  currency: string;
  createdAt: string;
  updatedAt: string;
}): PaymentRecord {
  return {
    id: row.id,
    orderId: row.orderId,
    method: row.method,
    status: row.status,
    amountMinor: parseMinorUnits(row.amountMinor),
    currency: row.currency,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toTransaction(row: {
  id: string;
  paymentId: string;
  provider: string;
  providerReference: string | null;
  status: string;
  amountMinor: unknown;
  idempotencyKey: string;
  processedAt: string | null;
  createdAt: string;
}): PaymentTransactionRecord {
  return {
    id: row.id,
    paymentId: row.paymentId,
    provider: row.provider,
    providerReference: row.providerReference,
    status: row.status,
    amountMinor: parseMinorUnits(row.amountMinor),
    idempotencyKey: row.idempotencyKey,
    processedAt: row.processedAt,
    createdAt: row.createdAt,
  };
}

export type OwnedPaymentContext = {
  payment: PaymentRecord;
  orderStatus: string;
  fulfillmentStatus: string;
  snapshotPayableMinor: number;
  snapshotCurrency: string;
};

@Injectable()
export class PaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  runInTransaction<T>(fn: (tx: OrmClient) => Promise<T>): Promise<T> {
    return this.db().transaction(fn);
  }

  async findCustomerIdByAccountId(accountId: string): Promise<string | null> {
    const row = await orm(this.db())
      .CustomerProfile.where({ accountId })
      .first();
    return row?.id ?? null;
  }

  async findOwnedPaymentContext(
    customerId: string,
    orderId: string,
    client?: OrmClient,
  ): Promise<OwnedPaymentContext | null> {
    const db = client ?? this.db();
    const order = await orm(db)
      .Order.where({ id: orderId, customerId })
      .first();
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
      payment: toPayment(payment),
      orderStatus: order.status,
      fulfillmentStatus: order.fulfillmentStatus,
      snapshotPayableMinor: parseMinorUnits(snapshot.customerPayableMinor),
      snapshotCurrency: snapshot.currency,
    };
  }

  async lockPayment(
    paymentId: string,
    client: OrmClient,
  ): Promise<PaymentRecord | null> {
    await orm(client).Payment.where({ id: paymentId }).update({
      updatedAt: pgNow(),
    });
    const row = await orm(client).Payment.where({ id: paymentId }).first();
    return row ? toPayment(row) : null;
  }

  async findOpenAttempt(
    paymentId: string,
    client?: OrmClient,
  ): Promise<PaymentTransactionRecord | null> {
    const rows = await orm(client ?? this.db())
      .PaymentTransaction.where({ paymentId })
      .all();
    const open = rows
      .map(toTransaction)
      .find(
        (row) => isOpenAttemptStatus(row.status) && row.processedAt == null,
      );
    return open ?? null;
  }

  async findLatestInitiatedAttempt(
    paymentId: string,
    client?: OrmClient,
  ): Promise<PaymentTransactionRecord | null> {
    const rows = await orm(client ?? this.db())
      .PaymentTransaction.where({ paymentId })
      .all();
    const initiated = rows
      .map(toTransaction)
      .filter((row) => row.status === 'INITIATED' && row.providerReference)
      .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1));
    return initiated[0] ?? null;
  }

  async findTransactionByIdempotencyKey(
    idempotencyKey: string,
    client?: OrmClient,
  ): Promise<PaymentTransactionRecord | null> {
    const row = await orm(client ?? this.db())
      .PaymentTransaction.where({
        idempotencyKey: pgVarchar<128>(idempotencyKey),
      })
      .first();
    return row ? toTransaction(row) : null;
  }

  async findTransactionsByProviderReference(
    providerReference: string,
    client?: OrmClient,
  ): Promise<PaymentTransactionRecord[]> {
    const rows = await orm(client ?? this.db())
      .PaymentTransaction.where({
        providerReference: pgVarchar<255>(providerReference),
      })
      .all();
    return rows.map(toTransaction);
  }

  async insertCreatedAttempt(
    input: {
      id: string;
      paymentId: string;
      provider: string;
      amountMinor: number;
      idempotencyKey: string;
    },
    client: OrmClient,
  ): Promise<PaymentTransactionRecord> {
    const now = pgNow();
    const id = input.id;
    await orm(client).PaymentTransaction.create({
      id,
      paymentId: input.paymentId,
      provider: pgVarchar<64>(input.provider),
      providerReference: null,
      status: pgVarchar<64>('CREATED'),
      amountMinor: pgBigInt(input.amountMinor),
      idempotencyKey: pgVarchar<128>(input.idempotencyKey),
      processedAt: null,
      createdAt: now,
    });
    const row = await orm(client).PaymentTransaction.where({ id }).first();
    if (!row) {
      throw new Error('PaymentTransaction insert failed');
    }
    return toTransaction(row);
  }

  async markPaymentProcessing(
    paymentId: string,
    client: OrmClient,
  ): Promise<void> {
    await orm(client).Payment.where({ id: paymentId }).update({
      status: PAYMENT_STATUS_PROCESSING,
      updatedAt: pgNow(),
    });
  }

  async markPaymentPending(
    paymentId: string,
    client: OrmClient,
  ): Promise<void> {
    await orm(client).Payment.where({ id: paymentId }).update({
      status: PAYMENT_STATUS_PENDING,
      updatedAt: pgNow(),
    });
  }

  async markPaymentSucceeded(
    paymentId: string,
    client: OrmClient,
  ): Promise<void> {
    await orm(client).Payment.where({ id: paymentId }).update({
      status: PAYMENT_STATUS_SUCCEEDED,
      updatedAt: pgNow(),
    });
  }

  async finalizeInitiated(
    transactionId: string,
    providerReference: string,
    client: OrmClient,
  ): Promise<PaymentTransactionRecord | null> {
    await orm(client)
      .PaymentTransaction.where({ id: transactionId })
      .update({
        providerReference: pgVarchar<255>(providerReference),
        status: pgVarchar<64>('INITIATED'),
      });
    const row = await orm(client)
      .PaymentTransaction.where({ id: transactionId })
      .first();
    return row ? toTransaction(row) : null;
  }

  async closeAttempt(
    transactionId: string,
    status: string,
    client: OrmClient,
  ): Promise<void> {
    await orm(client)
      .PaymentTransaction.where({ id: transactionId })
      .update({
        status: pgVarchar<64>(status),
        processedAt: pgNow(),
      });
  }

  async insertWebhookTransaction(
    input: {
      paymentId: string;
      provider: string;
      providerReference: string;
      status: string;
      amountMinor: number;
      idempotencyKey: string;
    },
    client: OrmClient,
  ): Promise<PaymentTransactionRecord> {
    const now = pgNow();
    const id = createUuidV7();
    await orm(client).PaymentTransaction.create({
      id,
      paymentId: input.paymentId,
      provider: pgVarchar<64>(input.provider),
      providerReference: pgVarchar<255>(input.providerReference),
      status: pgVarchar<64>(input.status),
      amountMinor: pgBigInt(input.amountMinor),
      idempotencyKey: pgVarchar<128>(input.idempotencyKey),
      processedAt: now,
      createdAt: now,
    });
    const row = await orm(client).PaymentTransaction.where({ id }).first();
    if (!row) {
      throw new Error('Webhook PaymentTransaction insert failed');
    }
    return toTransaction(row);
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
}
