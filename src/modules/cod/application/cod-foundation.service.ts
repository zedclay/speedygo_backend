import { Injectable } from '@nestjs/common';
import { isPostgresUniqueViolation } from '../../../common/errors/postgres-unique';
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
import { DELIVERY_STATUS_ARRIVED_CUSTOMER } from '../../delivery/domain/delivery.policy';
import { DriverRepository } from '../../drivers/infrastructure/driver.repository';
import { FinancialLedgerService } from '../../financial-ledger/application/financial-ledger.service';
import { isAcceptedAssignment } from '../../matching/domain/matching.policy';
import {
  ORDER_PAYMENT_METHOD_COD,
  ORDER_STATUS_ACTIVE,
  PAYMENT_STATUS_PENDING,
  PAYMENT_STATUS_SUCCEEDED,
} from '../../orders/domain/order.policy';
import {
  driverCodCollectionAmountMismatch,
  driverCodCollectionAlreadyExists,
  driverCodCollectionAssignmentNotActive,
  driverCodCollectionInconsistentState,
  driverCodCollectionMethodNotCod,
  driverCodCollectionNotReady,
  driverCodCollectionPaymentNotEligible,
  driverCodProfileNotFound,
  driverCodRemittanceAlreadyConfirmed,
  driverCodRemittanceInsufficientCustody,
  driverCodRemittanceInvalidAmount,
  driverCodRemittanceInvalidState,
  driverCodRemittanceNotFound,
  driverCodRemittanceOpenExists,
} from '../domain/cod.errors';
import {
  COD_COLLECTION_STATUS_COLLECTED,
  COD_CURRENCY_DZD,
  COD_DISCREPANCY_STATUS_OPEN,
  COD_REMITTANCE_STATUS_CONFIRMED,
  COD_REMITTANCE_STATUS_DECLARED,
  isExactCodAmount,
  isPositiveMinor,
} from '../domain/cod.policy';

export type OrmClient = { orm: SpeedyGoDb['orm'] };

function orm(client: OrmClient) {
  return client.orm.public;
}

function newCodReference(prefix: string): string {
  return `${prefix}_${createUuidV7().replaceAll('-', '')}`.slice(0, 64);
}

export type CodCollectionView = {
  orderId: string;
  codCollectionId: string;
  expectedAmountMinor: number;
  collectedAmountMinor: number;
  codCollectionStatus: string;
  paymentStatus: string;
};

export type CodDriverSummaryView = {
  outstandingCustodyMinor: number;
  collectedAmountMinor: number;
  confirmedAllocatedMinor: number;
  openDeclaredCount: number;
};

export type CodRemittanceView = {
  remittanceId: string;
  reference: string;
  submittedAmountMinor: number;
  confirmedAmountMinor: number;
  status: string;
};

@Injectable()
export class CodFoundationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly drivers: DriverRepository,
    private readonly ledger: FinancialLedgerService,
  ) {}

  async collectCod(
    accountId: string,
    collectedAmountMinor: number,
  ): Promise<CodCollectionView> {
    if (
      !Number.isInteger(collectedAmountMinor) ||
      !Number.isSafeInteger(collectedAmountMinor) ||
      collectedAmountMinor < 0
    ) {
      throw driverCodCollectionAmountMismatch();
    }

    try {
      return await this.prisma.getDb().transaction(async (tx: OrmClient) => {
        return this.collectCodInTransaction(
          accountId,
          collectedAmountMinor,
          tx,
        );
      });
    } catch (error) {
      if (!isPostgresUniqueViolation(error)) {
        throw error;
      }
      // Concurrent create lost the UNIQUE(order_id) race — reuse winner.
      return this.prisma.getDb().transaction(async (tx: OrmClient) => {
        return this.collectCodInTransaction(
          accountId,
          collectedAmountMinor,
          tx,
          true,
        );
      });
    }
  }

  private async collectCodInTransaction(
    accountId: string,
    collectedAmountMinor: number,
    tx: OrmClient,
    afterUniqueRace = false,
  ): Promise<CodCollectionView> {
    const now = pgNow();
    const profile = await this.drivers.findProfileByAccountId(accountId, tx);
    if (!profile) {
      throw driverCodCollectionAssignmentNotActive();
    }

    // Serialize per-driver financial mutations (collection / remittance).
    await orm(tx).DriverProfile.where({ id: profile.id }).update({
      updatedAt: now,
    });

    const open = await this.drivers.findOpenAcceptedAssignment(profile.id, tx);
    if (!open || !isAcceptedAssignment(open.status, null)) {
      throw driverCodCollectionAssignmentNotActive();
    }

    const delivery = await orm(tx)
      .Delivery.where({ id: open.deliveryId })
      .first();
    if (!delivery || delivery.status !== DELIVERY_STATUS_ARRIVED_CUSTOMER) {
      throw driverCodCollectionNotReady();
    }

    const order = await orm(tx)
      .Order.where({ id: delivery.orderId, status: ORDER_STATUS_ACTIVE })
      .first();
    if (!order) {
      throw driverCodCollectionNotReady();
    }

    await orm(tx).Payment.where({ orderId: order.id }).update({
      updatedAt: now,
    });
    const payment = await orm(tx).Payment.where({ orderId: order.id }).first();
    if (!payment) {
      throw driverCodCollectionPaymentNotEligible();
    }
    if (payment.method !== ORDER_PAYMENT_METHOD_COD) {
      throw driverCodCollectionMethodNotCod();
    }
    if (payment.currency !== COD_CURRENCY_DZD) {
      throw driverCodCollectionPaymentNotEligible();
    }

    const existing = await orm(tx)
      .CodCollection.where({ orderId: order.id })
      .first();
    if (existing) {
      return this.reuseExistingCollection(
        {
          existing,
          payment,
          driverId: profile.id,
          collectedAmountMinor,
        },
        tx,
      );
    }

    if (payment.status === PAYMENT_STATUS_SUCCEEDED) {
      // SUCCEEDED without CodCollection is an inconsistent COD state.
      throw driverCodCollectionInconsistentState();
    }
    if (payment.status !== PAYMENT_STATUS_PENDING) {
      throw driverCodCollectionPaymentNotEligible();
    }
    if (afterUniqueRace) {
      // Unique race claimed a row should exist; fail closed if missing.
      throw driverCodCollectionInconsistentState();
    }

    const snapshot = await orm(tx)
      .OrderFinancialSnapshot.where({ orderId: order.id })
      .first();
    if (!snapshot || snapshot.currency !== COD_CURRENCY_DZD) {
      throw driverCodCollectionNotReady();
    }

    const paymentAmountMinor = parseMinorUnits(payment.amountMinor);
    const snapshotPayableMinor = parseMinorUnits(snapshot.customerPayableMinor);
    if (
      !isExactCodAmount({
        collectedAmountMinor,
        paymentAmountMinor,
        snapshotPayableMinor,
      })
    ) {
      throw driverCodCollectionAmountMismatch();
    }

    const codCollectionId = createUuidV7();
    await orm(tx).CodCollection.create({
      id: codCollectionId,
      orderId: order.id,
      driverId: profile.id,
      expectedAmountMinor: pgBigInt(paymentAmountMinor),
      collectedAmountMinor: pgBigInt(collectedAmountMinor),
      collectedAt: now,
      status: pgVarchar<64>(COD_COLLECTION_STATUS_COLLECTED),
      createdAt: now,
    });

    await orm(tx).Payment.where({ id: payment.id }).update({
      status: PAYMENT_STATUS_SUCCEEDED,
      updatedAt: now,
    });

    await this.ledger.postCodCollection(
      {
        collectionId: codCollectionId,
        orderId: order.id,
        driverId: profile.id,
        amountMinor: collectedAmountMinor,
      },
      tx,
    );

    return {
      orderId: order.id,
      codCollectionId,
      expectedAmountMinor: paymentAmountMinor,
      collectedAmountMinor,
      codCollectionStatus: COD_COLLECTION_STATUS_COLLECTED,
      paymentStatus: PAYMENT_STATUS_SUCCEEDED,
    };
  }

  private async reuseExistingCollection(
    input: {
      existing: {
        id: string;
        orderId: string;
        driverId: string;
        expectedAmountMinor: unknown;
        collectedAmountMinor: unknown;
        status: string;
      };
      payment: {
        status: string;
        amountMinor: unknown;
        method: string;
        currency: string;
      };
      driverId: string;
      collectedAmountMinor: number;
    },
    tx: OrmClient,
  ): Promise<CodCollectionView> {
    const expected = parseMinorUnits(input.existing.expectedAmountMinor);
    const collected = parseMinorUnits(input.existing.collectedAmountMinor);
    const paymentAmount = parseMinorUnits(input.payment.amountMinor);

    if (input.existing.driverId !== input.driverId) {
      throw driverCodCollectionAlreadyExists();
    }
    if (input.existing.status !== COD_COLLECTION_STATUS_COLLECTED) {
      throw driverCodCollectionInconsistentState();
    }
    if (
      collected !== input.collectedAmountMinor ||
      collected !== expected ||
      collected !== paymentAmount
    ) {
      throw driverCodCollectionAlreadyExists();
    }
    if (input.payment.currency !== COD_CURRENCY_DZD) {
      throw driverCodCollectionInconsistentState();
    }
    if (input.payment.status !== PAYMENT_STATUS_SUCCEEDED) {
      throw driverCodCollectionInconsistentState();
    }

    await this.ledger.postCodCollection(
      {
        collectionId: input.existing.id,
        orderId: input.existing.orderId,
        driverId: input.existing.driverId,
        amountMinor: collected,
      },
      tx,
    );

    return {
      orderId: input.existing.orderId,
      codCollectionId: input.existing.id,
      expectedAmountMinor: expected,
      collectedAmountMinor: collected,
      codCollectionStatus: COD_COLLECTION_STATUS_COLLECTED,
      paymentStatus: PAYMENT_STATUS_SUCCEEDED,
    };
  }

  async getDriverCodSummary(accountId: string): Promise<CodDriverSummaryView> {
    const profile = await this.drivers.findProfileByAccountId(accountId);
    if (!profile) {
      throw driverCodProfileNotFound();
    }
    return this.computeOutstandingCustody(profile.id);
  }

  async submitCodRemittance(
    accountId: string,
    submittedAmountMinor: number,
  ): Promise<CodRemittanceView> {
    if (!isPositiveMinor(submittedAmountMinor)) {
      throw driverCodRemittanceInvalidAmount();
    }

    return this.prisma.getDb().transaction(async (tx: OrmClient) => {
      const profile = await this.drivers.findProfileByAccountId(accountId, tx);
      if (!profile) {
        throw driverCodProfileNotFound();
      }

      const now = pgNow();
      await orm(tx).DriverProfile.where({ id: profile.id }).update({
        updatedAt: now,
      });

      const openDeclared = await orm(tx)
        .CodRemittance.where({
          driverId: profile.id,
          status: pgVarchar<64>(COD_REMITTANCE_STATUS_DECLARED),
        })
        .all();
      if (openDeclared.length > 0) {
        throw driverCodRemittanceOpenExists();
      }

      const custody = await this.computeOutstandingCustody(profile.id, tx);
      if (submittedAmountMinor > custody.outstandingCustodyMinor) {
        throw driverCodRemittanceInsufficientCustody();
      }

      const remittanceId = createUuidV7();
      const reference = newCodReference('codr');
      await orm(tx).CodRemittance.create({
        id: remittanceId,
        driverId: profile.id,
        submittedAmountMinor: pgBigInt(submittedAmountMinor),
        confirmedAmountMinor: pgBigInt(0),
        status: pgVarchar<64>(COD_REMITTANCE_STATUS_DECLARED),
        reference: pgVarchar<64>(reference),
        proofUrl: null,
        submittedAt: now,
        confirmedAt: null,
        createdAt: now,
      });

      return {
        remittanceId,
        reference,
        submittedAmountMinor,
        confirmedAmountMinor: 0,
        status: COD_REMITTANCE_STATUS_DECLARED,
      };
    });
  }

  /**
   * Trusted internal platform authority only. Not exposed as public Admin HTTP
   * without Admin orchestration. InTx never opens a nested transaction.
   */
  async confirmCodRemittance(
    remittanceId: string,
    confirmedAmountMinor: number,
  ): Promise<CodRemittanceView> {
    return this.prisma
      .getDb()
      .transaction((tx: OrmClient) =>
        this.confirmCodRemittanceInTx(tx, remittanceId, confirmedAmountMinor),
      );
  }

  async confirmCodRemittanceInTx(
    tx: OrmClient,
    remittanceId: string,
    confirmedAmountMinor: number,
  ): Promise<CodRemittanceView> {
    if (!isPositiveMinor(confirmedAmountMinor)) {
      throw driverCodRemittanceInvalidAmount();
    }

    const remittance = await orm(tx)
      .CodRemittance.where({ id: remittanceId })
      .first();
    if (!remittance) {
      throw driverCodRemittanceNotFound();
    }

    if (remittance.status === COD_REMITTANCE_STATUS_CONFIRMED) {
      const existingAllocations = await orm(tx)
        .CodRemittanceAllocation.where({ remittanceId: remittance.id })
        .all();
      const allocatedSum = existingAllocations.reduce(
        (sum, row) => sum + parseMinorUnits(row.allocatedAmountMinor),
        0,
      );
      if (allocatedSum !== parseMinorUnits(remittance.confirmedAmountMinor)) {
        throw driverCodRemittanceInvalidState();
      }
      throw driverCodRemittanceAlreadyConfirmed();
    }

    if (remittance.status !== COD_REMITTANCE_STATUS_DECLARED) {
      throw driverCodRemittanceInvalidState();
    }

    const driverId = remittance.driverId;
    const now = pgNow();
    await orm(tx).DriverProfile.where({ id: driverId }).update({
      updatedAt: now,
    });

    // Re-read remittance under driver lock.
    const locked = await orm(tx)
      .CodRemittance.where({ id: remittanceId })
      .first();
    if (!locked || locked.status !== COD_REMITTANCE_STATUS_DECLARED) {
      throw driverCodRemittanceAlreadyConfirmed();
    }

    const custody = await this.computeOutstandingCustody(driverId, tx);
    if (confirmedAmountMinor > custody.outstandingCustodyMinor) {
      throw driverCodRemittanceInsufficientCustody();
    }

    const collections = await orm(tx)
      .CodCollection.where({
        driverId,
        status: pgVarchar<64>(COD_COLLECTION_STATUS_COLLECTED),
      })
      .all();
    collections.sort((left, right) => {
      if (left.collectedAt !== right.collectedAt) {
        return left.collectedAt < right.collectedAt ? -1 : 1;
      }
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });

    const allocatedByCollectionId =
      await this.loadConfirmedAllocationsByCollection(driverId, tx);

    let remaining = confirmedAmountMinor;
    const planned: Array<{ collectionId: string; amount: number }> = [];
    for (const collection of collections) {
      if (remaining === 0) {
        break;
      }
      const already = allocatedByCollectionId.get(collection.id) ?? 0;
      const collected = parseMinorUnits(collection.collectedAmountMinor);
      const available = Math.max(0, collected - already);
      if (available <= 0) {
        continue;
      }
      const toAllocate = Math.min(available, remaining);
      planned.push({ collectionId: collection.id, amount: toAllocate });
      remaining -= toAllocate;
    }

    if (remaining !== 0) {
      throw driverCodRemittanceInsufficientCustody();
    }

    const allocatedSum = planned.reduce((sum, row) => sum + row.amount, 0);
    if (allocatedSum !== confirmedAmountMinor) {
      throw driverCodRemittanceInsufficientCustody();
    }

    for (const row of planned) {
      await orm(tx).CodRemittanceAllocation.create({
        id: createUuidV7(),
        remittanceId: locked.id,
        collectionId: row.collectionId,
        allocatedAmountMinor: pgBigInt(row.amount),
        createdAt: now,
      });
    }

    await orm(tx)
      .CodRemittance.where({ id: locked.id })
      .update({
        status: pgVarchar<64>(COD_REMITTANCE_STATUS_CONFIRMED),
        confirmedAmountMinor: pgBigInt(confirmedAmountMinor),
        confirmedAt: now,
      });

    const submitted = parseMinorUnits(locked.submittedAmountMinor);
    if (confirmedAmountMinor !== submitted) {
      const existingDiscrepancy = await orm(tx)
        .CodDiscrepancy.where({ remittanceId: locked.id })
        .first();
      if (!existingDiscrepancy) {
        await orm(tx).CodDiscrepancy.create({
          id: createUuidV7(),
          driverId,
          remittanceId: locked.id,
          expectedMinor: pgBigInt(submitted),
          confirmedMinor: pgBigInt(confirmedAmountMinor),
          differenceMinor: pgBigInt(confirmedAmountMinor - submitted),
          status: pgVarchar<64>(COD_DISCREPANCY_STATUS_OPEN),
          cause: 'DECLARED_VS_CONFIRMED',
          resolution: null,
          createdAt: now,
          resolvedAt: null,
        });
      }
    }

    await this.ledger.postCodRemittanceConfirmed(
      {
        remittanceId: locked.id,
        driverId,
        confirmedAmountMinor,
      },
      tx,
    );

    return {
      remittanceId: locked.id,
      reference: locked.reference,
      submittedAmountMinor: submitted,
      confirmedAmountMinor,
      status: COD_REMITTANCE_STATUS_CONFIRMED,
    };
  }

  private async computeOutstandingCustody(
    driverId: string,
    client?: OrmClient,
  ): Promise<CodDriverSummaryView> {
    const db = client ?? { orm: this.prisma.getDb().orm };
    const collections = await orm(db)
      .CodCollection.where({
        driverId,
        status: pgVarchar<64>(COD_COLLECTION_STATUS_COLLECTED),
      })
      .all();
    const collectedAmountMinor = collections.reduce(
      (sum, row) => sum + parseMinorUnits(row.collectedAmountMinor),
      0,
    );

    const allocatedByCollectionId =
      await this.loadConfirmedAllocationsByCollection(driverId, db);
    let confirmedAllocatedMinor = 0;
    for (const amount of allocatedByCollectionId.values()) {
      confirmedAllocatedMinor += amount;
    }

    const openDeclared = await orm(db)
      .CodRemittance.where({
        driverId,
        status: pgVarchar<64>(COD_REMITTANCE_STATUS_DECLARED),
      })
      .all();

    const outstandingCustodyMinor =
      collectedAmountMinor - confirmedAllocatedMinor;
    if (outstandingCustodyMinor < 0) {
      throw driverCodRemittanceInsufficientCustody();
    }

    return {
      outstandingCustodyMinor,
      collectedAmountMinor,
      confirmedAllocatedMinor,
      openDeclaredCount: openDeclared.length,
    };
  }

  private async loadConfirmedAllocationsByCollection(
    driverId: string,
    client: OrmClient,
  ): Promise<Map<string, number>> {
    const confirmed = await orm(client)
      .CodRemittance.where({
        driverId,
        status: pgVarchar<64>(COD_REMITTANCE_STATUS_CONFIRMED),
      })
      .all();
    const map = new Map<string, number>();
    for (const remittance of confirmed) {
      const allocations = await orm(client)
        .CodRemittanceAllocation.where({ remittanceId: remittance.id })
        .all();
      for (const allocation of allocations) {
        const prev = map.get(allocation.collectionId) ?? 0;
        map.set(
          allocation.collectionId,
          prev + parseMinorUnits(allocation.allocatedAmountMinor),
        );
      }
    }
    return map;
  }
}
