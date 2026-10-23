import { Injectable } from '@nestjs/common';
import { moneyMinorToDecimalString } from '../../../common/money/money-minor';
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
  deriveAdminCodDriverReconciliationStatus,
  isExactCodAmount,
  isPositiveMinor,
  type AdminCodDriverReconciliationStatus,
} from '../domain/cod.policy';
const ADMIN_COD_SUMMARY_DEFAULT_LIMIT = 50;
const ADMIN_COD_SUMMARY_MAX_LIMIT = 100;
const ADMIN_COD_SUMMARY_MAX_OFFSET = 10_000;

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
  expectedAmountMinor: string;
  collectedAmountMinor: string;
  codCollectionStatus: string;
  paymentStatus: string;
};

export type CodDriverSummaryView = {
  outstandingCustodyMinor: string;
  collectedAmountMinor: string;
  confirmedAllocatedMinor: string;
  openDeclaredCount: number;
};

/** Admin COD Suivi — one row per driver with custody maths (not remittance rows). */
export type AdminCodDriverSummaryView = {
  driverId: string;
  fullName: string;
  collectedOrderCount: number;
  /** SUM(COLLECTED) — Stitch “montant attendu”. */
  collectedAmountMinor: string;
  /** SUM(confirmed allocations) — Stitch “montant remis”. */
  confirmedAllocatedMinor: string;
  /** collected − confirmedAllocated — Stitch “reste à remettre”. */
  outstandingCustodyMinor: string;
  openDeclaredCount: number;
  discrepancyRemittanceCount: number;
  reconciliationStatus: AdminCodDriverReconciliationStatus;
};

export type AdminCodDriverSummariesPage = {
  items: AdminCodDriverSummaryView[];
  total: number;
  limit: number;
  offset: number;
};

export type CodRemittanceView = {
  remittanceId: string;
  reference: string;
  submittedAmountMinor: string;
  confirmedAmountMinor: string;
  status: string;
};

type CodDriverCustodyInternal = {
  outstandingCustodyMinor: number;
  collectedAmountMinor: number;
  confirmedAllocatedMinor: number;
  openDeclaredCount: number;
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
      expectedAmountMinor: moneyMinorToDecimalString(paymentAmountMinor),
      collectedAmountMinor: moneyMinorToDecimalString(collectedAmountMinor),
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
      expectedAmountMinor: moneyMinorToDecimalString(expected),
      collectedAmountMinor: moneyMinorToDecimalString(collected),
      codCollectionStatus: COD_COLLECTION_STATUS_COLLECTED,
      paymentStatus: PAYMENT_STATUS_SUCCEEDED,
    };
  }

  async getDriverCodSummary(accountId: string): Promise<CodDriverSummaryView> {
    const profile = await this.drivers.findProfileByAccountId(accountId);
    if (!profile) {
      throw driverCodProfileNotFound();
    }
    return this.toDriverSummaryView(
      await this.computeOutstandingCustody(profile.id),
    );
  }

  /**
   * Admin Suivi COD: driver-aggregated custody rows.
   * Totals use the same outstanding-custody definition as driver self-summary;
   * aggregation + status filters run before pagination (never page-then-sum).
   */
  async listAdminCodDriverSummaries(input: {
    limit?: number;
    offset?: number;
    q?: string;
    reconciliationStatus?: AdminCodDriverReconciliationStatus;
  }): Promise<AdminCodDriverSummariesPage> {
    const limit = clampInt(
      input.limit ?? ADMIN_COD_SUMMARY_DEFAULT_LIMIT,
      1,
      ADMIN_COD_SUMMARY_MAX_LIMIT,
    );
    const offset = clampInt(
      input.offset ?? 0,
      0,
      ADMIN_COD_SUMMARY_MAX_OFFSET,
    );
    const all = await this.buildAdminCodDriverSummaries();
    const term = (input.q ?? '').trim().toLowerCase();
    const filtered = all.filter((row) => {
      if (
        input.reconciliationStatus &&
        row.reconciliationStatus !== input.reconciliationStatus
      ) {
        return false;
      }
      if (!term) {
        return true;
      }
      return (
        row.fullName.toLowerCase().includes(term) ||
        row.driverId.toLowerCase().includes(term)
      );
    });
    return {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
    };
  }

  async getAdminCodDriverSummary(
    driverId: string,
  ): Promise<AdminCodDriverSummaryView> {
    const row = (await this.buildAdminCodDriverSummaries()).find(
      (item) => item.driverId === driverId,
    );
    if (!row) {
      throw driverCodProfileNotFound();
    }
    return row;
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
        submittedAmountMinor: moneyMinorToDecimalString(submittedAmountMinor),
        confirmedAmountMinor: moneyMinorToDecimalString(0),
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
      submittedAmountMinor: moneyMinorToDecimalString(submitted),
      confirmedAmountMinor: moneyMinorToDecimalString(confirmedAmountMinor),
      status: COD_REMITTANCE_STATUS_CONFIRMED,
    };
  }

  private async computeOutstandingCustody(
    driverId: string,
    client?: OrmClient,
  ): Promise<CodDriverCustodyInternal> {
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

  private toDriverSummaryView(
    custody: CodDriverCustodyInternal,
  ): CodDriverSummaryView {
    return {
      outstandingCustodyMinor: moneyMinorToDecimalString(
        custody.outstandingCustodyMinor,
      ),
      collectedAmountMinor: moneyMinorToDecimalString(
        custody.collectedAmountMinor,
      ),
      confirmedAllocatedMinor: moneyMinorToDecimalString(
        custody.confirmedAllocatedMinor,
      ),
      openDeclaredCount: custody.openDeclaredCount,
    };
  }

  private async buildAdminCodDriverSummaries(): Promise<
    AdminCodDriverSummaryView[]
  > {
    const db = { orm: this.prisma.getDb().orm };
    const collections = await orm(db)
      .CodCollection.where({
        status: pgVarchar<64>(COD_COLLECTION_STATUS_COLLECTED),
      })
      .all();
    const remittances = await orm(db).CodRemittance.all();

    const driverIds = new Set<string>();
    const collectedOrderCountByDriver = new Map<string, number>();
    for (const row of collections) {
      driverIds.add(row.driverId);
      collectedOrderCountByDriver.set(
        row.driverId,
        (collectedOrderCountByDriver.get(row.driverId) ?? 0) + 1,
      );
    }
    for (const row of remittances) {
      driverIds.add(row.driverId);
    }

    const discrepancyByDriver = new Map<string, number>();
    for (const row of remittances) {
      if (row.status !== COD_REMITTANCE_STATUS_CONFIRMED) {
        continue;
      }
      const submitted = parseMinorUnits(row.submittedAmountMinor);
      const confirmed = parseMinorUnits(row.confirmedAmountMinor);
      if (submitted === confirmed) {
        continue;
      }
      discrepancyByDriver.set(
        row.driverId,
        (discrepancyByDriver.get(row.driverId) ?? 0) + 1,
      );
    }

    const items: AdminCodDriverSummaryView[] = [];
    for (const driverId of driverIds) {
      const profile = await orm(db).DriverProfile.where({ id: driverId }).first();
      if (!profile) {
        continue;
      }
      const custody = await this.computeOutstandingCustody(driverId, db);
      const discrepancyRemittanceCount =
        discrepancyByDriver.get(driverId) ?? 0;
      items.push({
        driverId,
        fullName: profile.fullName,
        collectedOrderCount: collectedOrderCountByDriver.get(driverId) ?? 0,
        collectedAmountMinor: moneyMinorToDecimalString(
          custody.collectedAmountMinor,
        ),
        confirmedAllocatedMinor: moneyMinorToDecimalString(
          custody.confirmedAllocatedMinor,
        ),
        outstandingCustodyMinor: moneyMinorToDecimalString(
          custody.outstandingCustodyMinor,
        ),
        openDeclaredCount: custody.openDeclaredCount,
        discrepancyRemittanceCount,
        reconciliationStatus: deriveAdminCodDriverReconciliationStatus({
          collectedAmountMinor: custody.collectedAmountMinor,
          confirmedAllocatedMinor: custody.confirmedAllocatedMinor,
          discrepancyRemittanceCount,
        }),
      });
    }

    items.sort((a, b) => {
      const aOut = parseMinorUnits(a.outstandingCustodyMinor);
      const bOut = parseMinorUnits(b.outstandingCustodyMinor);
      if (bOut !== aOut) {
        return bOut - aOut;
      }
      return a.fullName.localeCompare(b.fullName);
    });
    return items;
  }
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
