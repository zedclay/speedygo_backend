import { Injectable } from '@nestjs/common';
import { isPostgresUniqueViolation } from '../../../common/errors/postgres-unique';
import { driverProfileNotFound } from '../../drivers/domain/driver.errors';
import { DriverRepository } from '../../drivers/infrastructure/driver.repository';
import { FinancialLedgerService } from '../../financial-ledger/application/financial-ledger.service';
import {
  driverEarningAlreadyExists,
  driverEarningAssignmentInvalid,
  driverEarningDeliveryNotCompleted,
  driverEarningFinancialStateInvalid,
} from '../domain/driver-remuneration.errors';
import {
  buildDriverEarningAmounts,
  earningListEarnedAt,
  normalizeDriverEarningListQuery,
} from '../domain/driver-remuneration.policy';
import {
  DRIVER_EARNING_CURRENCY_DZD,
  DRIVER_EARNING_STATUS_EARNED,
  type CreateDriverEarningForCompletedDeliveryInput,
  type DriverEarningListView,
  type DriverEarningRecord,
  type DriverEarningSummaryView,
} from '../domain/driver-remuneration.types';
import {
  DriverEarningRepository,
  type OrmClient,
} from '../infrastructure/driver-earning.repository';

@Injectable()
export class DriverRemunerationService {
  constructor(
    private readonly earnings: DriverEarningRepository,
    private readonly drivers: DriverRepository,
    private readonly ledger: FinancialLedgerService,
  ) {}

  /**
   * Creates exactly one EARNED DriverEarning inside the Delivery completion transaction.
   * Amount = immutable OrderFinancialSnapshot.driverRemunerationMinor (same as Matching offer).
   * bonus/adjustment = 0 in v1.0. Does not create payout, COD mutation, or settlement.
   */
  async createForCompletedDelivery(
    input: CreateDriverEarningForCompletedDeliveryInput,
    client: OrmClient,
  ): Promise<DriverEarningRecord> {
    if (!input.driverId || !input.deliveryId || !input.orderId) {
      throw driverEarningAssignmentInvalid();
    }
    const existing = await this.earnings.findByDeliveryId(
      input.deliveryId,
      client,
    );
    if (existing) {
      if (
        existing.driverId === input.driverId &&
        existing.status === DRIVER_EARNING_STATUS_EARNED
      ) {
        await this.ledger.postDriverEarning(
          {
            earningId: existing.id,
            orderId: input.orderId,
            driverId: existing.driverId,
            netEarningMinor: existing.netEarningMinor,
          },
          client,
        );
        return existing;
      }
      throw driverEarningAlreadyExists();
    }

    const delivery = await client.orm.public.Delivery.where({
      id: input.deliveryId,
    }).first();
    if (
      !delivery ||
      delivery.orderId !== input.orderId ||
      delivery.status !== 'DELIVERED'
    ) {
      throw driverEarningDeliveryNotCompleted();
    }

    const snapshot = await this.earnings.findDriverRemunerationSnapshot(
      input.orderId,
      client,
    );
    if (!snapshot) {
      throw driverEarningFinancialStateInvalid(
        'Order financial snapshot is missing for Driver earning',
      );
    }
    const amounts = buildDriverEarningAmounts(snapshot.driverRemunerationMinor);

    try {
      const created = await this.earnings.createEarned(
        {
          deliveryId: input.deliveryId,
          driverId: input.driverId,
          baseRemunerationMinor: amounts.baseRemunerationMinor,
          bonusMinor: amounts.bonusMinor,
          adjustmentMinor: amounts.adjustmentMinor,
          netEarningMinor: amounts.netEarningMinor,
          validatedAt: input.occurredAt,
        },
        client,
      );
      await this.ledger.postDriverEarning(
        {
          earningId: created.id,
          orderId: input.orderId,
          driverId: created.driverId,
          netEarningMinor: created.netEarningMinor,
        },
        client,
      );
      return created;
    } catch (error) {
      if (!isPostgresUniqueViolation(error)) {
        throw error;
      }
      const raced = await this.earnings.findByDeliveryId(
        input.deliveryId,
        client,
      );
      if (
        raced &&
        raced.driverId === input.driverId &&
        raced.netEarningMinor === amounts.netEarningMinor &&
        raced.status === DRIVER_EARNING_STATUS_EARNED
      ) {
        await this.ledger.postDriverEarning(
          {
            earningId: raced.id,
            orderId: input.orderId,
            driverId: raced.driverId,
            netEarningMinor: raced.netEarningMinor,
          },
          client,
        );
        return raced;
      }
      throw driverEarningAlreadyExists();
    }
  }

  async getSummary(accountId: string): Promise<DriverEarningSummaryView> {
    const profile = await this.drivers.findProfileByAccountId(accountId);
    if (!profile) {
      throw driverProfileNotFound();
    }
    const aggregates = await this.earnings.aggregateDriverEarnings(profile.id);
    return {
      totalEarnedMinor: aggregates.totalEarnedMinor,
      unpaidEarnedMinor: aggregates.unpaidEarnedMinor,
      earningCount: aggregates.earningCount,
      currency: DRIVER_EARNING_CURRENCY_DZD,
    };
  }

  async listEarnings(
    accountId: string,
    query: { limit?: number; offset?: number },
  ): Promise<DriverEarningListView> {
    const profile = await this.drivers.findProfileByAccountId(accountId);
    if (!profile) {
      throw driverProfileNotFound();
    }
    const page = normalizeDriverEarningListQuery(query);
    const listed = await this.earnings.listDriverEarnings(profile.id, page);
    return {
      items: listed.items.map((row) => ({
        earningId: row.id,
        deliveryId: row.deliveryId,
        orderId: row.orderId,
        amountMinor: row.netEarningMinor,
        currency: DRIVER_EARNING_CURRENCY_DZD,
        status: row.status,
        earnedAt: earningListEarnedAt(row),
      })),
      total: listed.total,
      limit: page.limit,
      offset: page.offset,
    };
  }
}
