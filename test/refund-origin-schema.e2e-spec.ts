import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { createUuidV7 } from '../src/common/utils/uuid-v7';
import { isPostgresCheckViolation } from '../src/common/errors/postgres-unique';
import { PrismaService } from '../src/infrastructure/database/database.module';
import {
  pgBigInt,
  pgNow,
  pgVarchar,
} from '../src/infrastructure/database/pg-values';

/**
 * Schema integrity checks for Refund origin + paidTerminalIntentKey migration.
 * Counts/structure only — no Customer PII printed.
 */
describe('Refund origin schema integrity (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('preserves existing ADMIN rows and enforces origin/actor/intent constraints', async () => {
    const db = prisma.getDb().orm.public;
    const adminRows = await db.Refund.where({ requestOrigin: 'ADMIN' }).all();
    expect(adminRows.length).toBeGreaterThan(0);
    expect(
      adminRows.every(
        (row) =>
          row.requestedByAdminId !== null && row.paidTerminalIntentKey === null,
      ),
    ).toBe(true);

    const sample = adminRows[0];
    const now = pgNow();

    // Multiple null intent keys remain allowed for ADMIN rows.
    const extraAdminId = createUuidV7();
    await db.Refund.create({
      id: extraAdminId,
      orderId: sample.orderId,
      paymentTransactionId: null,
      refundMethod: 'MANUAL_OTHER',
      amountMinor: pgBigInt(1),
      status: 'REQUESTED',
      reason: pgVarchar<255>('schema integrity admin clone'),
      internalNote: null,
      requestOrigin: 'ADMIN',
      requestedByAdminId: sample.requestedByAdminId,
      paidTerminalIntentKey: null,
      requestedAt: now,
      completedAt: null,
      createdAt: now,
    });
    await db.Refund.where({ id: extraAdminId }).delete();

    const key = `paid-terminal:v1:${createUuidV7()}`;
    const autoId = createUuidV7();
    await db.Refund.create({
      id: autoId,
      orderId: sample.orderId,
      paymentTransactionId: null,
      refundMethod: 'MANUAL_OTHER',
      amountMinor: pgBigInt(1),
      status: 'REQUESTED',
      reason: pgVarchar<255>('schema integrity auto'),
      internalNote: null,
      requestOrigin: 'CUSTOMER_CANCELLATION',
      requestedByAdminId: null,
      paidTerminalIntentKey: pgVarchar<128>(key),
      requestedAt: now,
      completedAt: null,
      createdAt: now,
    });

    try {
      await db.Refund.create({
        id: createUuidV7(),
        orderId: sample.orderId,
        paymentTransactionId: null,
        refundMethod: 'MANUAL_OTHER',
        amountMinor: pgBigInt(1),
        status: 'REQUESTED',
        reason: pgVarchar<255>('duplicate key'),
        internalNote: null,
        requestOrigin: 'MERCHANT_REJECTION',
        requestedByAdminId: null,
        paidTerminalIntentKey: pgVarchar<128>(key),
        requestedAt: now,
        completedAt: null,
        createdAt: now,
      });
      throw new Error('expected unique violation');
    } catch (error) {
      expect(String(error)).toMatch(/unique|duplicate|23505/i);
    }

    try {
      await db.Refund.create({
        id: createUuidV7(),
        orderId: sample.orderId,
        paymentTransactionId: null,
        refundMethod: 'MANUAL_OTHER',
        amountMinor: pgBigInt(1),
        status: 'REQUESTED',
        reason: pgVarchar<255>('admin without actor'),
        internalNote: null,
        requestOrigin: 'ADMIN',
        requestedByAdminId: null,
        paidTerminalIntentKey: null,
        requestedAt: now,
        completedAt: null,
        createdAt: now,
      });
      throw new Error('expected check violation');
    } catch (error) {
      expect(
        isPostgresCheckViolation(error) ||
          String(error).includes('refunds_origin_actor_intent'),
      ).toBe(true);
    }

    try {
      await db.Refund.create({
        id: createUuidV7(),
        orderId: sample.orderId,
        paymentTransactionId: null,
        refundMethod: 'MANUAL_OTHER',
        amountMinor: pgBigInt(1),
        status: 'REQUESTED',
        reason: pgVarchar<255>('auto with fake admin'),
        internalNote: null,
        requestOrigin: 'LATE_PAYMENT_SUCCESS',
        requestedByAdminId: sample.requestedByAdminId,
        paidTerminalIntentKey: pgVarchar<128>(
          `paid-terminal:v1:${createUuidV7()}`,
        ),
        requestedAt: now,
        completedAt: null,
        createdAt: now,
      });
      throw new Error('expected check violation');
    } catch (error) {
      expect(
        isPostgresCheckViolation(error) ||
          String(error).includes('refunds_origin_actor_intent'),
      ).toBe(true);
    }

    try {
      await db.Refund.create({
        id: createUuidV7(),
        orderId: sample.orderId,
        paymentTransactionId: null,
        refundMethod: 'MANUAL_OTHER',
        amountMinor: pgBigInt(1),
        status: 'REQUESTED',
        reason: pgVarchar<255>('auto without key'),
        internalNote: null,
        requestOrigin: 'CUSTOMER_CANCELLATION',
        requestedByAdminId: null,
        paidTerminalIntentKey: null,
        requestedAt: now,
        completedAt: null,
        createdAt: now,
      });
      throw new Error('expected check violation');
    } catch (error) {
      expect(
        isPostgresCheckViolation(error) ||
          String(error).includes('refunds_origin_actor_intent'),
      ).toBe(true);
    }

    await db.Refund.where({ id: autoId }).delete();
  });
});
