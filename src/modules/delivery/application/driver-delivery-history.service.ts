import { Injectable } from '@nestjs/common';
import { driverProfileNotFound } from '../../drivers/domain/driver.errors';
import { DriverRepository } from '../../drivers/infrastructure/driver.repository';
import {
  assertHistoryEarningOwnership,
  assertHistoryPrivacyKeys,
  isCompletedHistoryMembership,
  mapHistoryPublicFields,
  normalizeDriverDeliveryHistoryListQuery,
} from '../domain/driver-delivery-history.policy';
import {
  driverDeliveryHistoryIntegrity,
  driverDeliveryHistoryNotFound,
} from '../domain/driver-delivery-history.errors';
import type {
  DriverDeliveryHistoryDetailView,
  DriverDeliveryHistoryListView,
} from '../domain/driver-delivery-history.types';
import { DriverDeliveryHistoryRepository } from '../infrastructure/driver-delivery-history.repository';

@Injectable()
export class DriverDeliveryHistoryService {
  constructor(
    private readonly history: DriverDeliveryHistoryRepository,
    private readonly drivers: DriverRepository,
  ) {}

  async listHistory(
    accountId: string,
    query: {
      limit?: number;
      offset?: number;
      from?: string;
      to?: string;
    },
  ): Promise<DriverDeliveryHistoryListView> {
    const profile = await this.drivers.findProfileByAccountId(accountId);
    if (!profile) {
      throw driverProfileNotFound();
    }
    const page = normalizeDriverDeliveryHistoryListQuery(query);
    return this.history.runConsistentRead(async (tx) => {
      const total = await this.history.countCompletedHistory(
        profile.id,
        page,
        tx,
      );
      const rows = await this.history.listCompletedHistory(
        profile.id,
        page,
        tx,
      );
      const items = rows.map((row) => this.toListItem(row, profile.id));
      const result = {
        items,
        total,
        limit: page.limit,
        offset: page.offset,
      };
      assertHistoryPrivacyKeys(result);
      return result;
    });
  }

  async getHistoryDetail(
    accountId: string,
    deliveryId: string,
  ): Promise<DriverDeliveryHistoryDetailView> {
    const profile = await this.drivers.findProfileByAccountId(accountId);
    if (!profile) {
      throw driverProfileNotFound();
    }
    return this.history.runConsistentRead(async (tx) => {
      const row = await this.history.findCompletedHistoryByDeliveryId(
        profile.id,
        deliveryId,
        tx,
      );
      if (!row) {
        throw driverDeliveryHistoryNotFound();
      }
      // Completing serving rows only: RELEASED that match DriverEarning.driverId.
      // Non-serving accepted-then-released peers must not inflate this count.
      const servingCount = await this.history.countCompletingServingAssignments(
        deliveryId,
        tx,
      );
      if (servingCount !== 1) {
        throw driverDeliveryHistoryIntegrity(
          'Delivery has ambiguous historical completing serving DriverAssignment rows',
        );
      }
      const detail = this.toDetail(row, profile.id);
      assertHistoryPrivacyKeys(detail);
      return detail;
    });
  }

  private toListItem(
    row: {
      deliveryId: string;
      orderId: string;
      orderPublicReference: string;
      deliveryStatus: string;
      deliveredAt: string;
      merchantName: string;
      branchName: string;
      paymentMethod: string | null;
      pickedUpAt: string | null;
      arrivedCustomerAt: string | null;
      assignmentId: string;
      servingDriverId: string;
      earningId: string;
      earningDriverId: string;
      earningStatus: string;
      earningAmountMinor: bigint;
      earnedAt: string;
    },
    expectedDriverId: string,
  ) {
    if (
      !isCompletedHistoryMembership({
        delivery: {
          status: row.deliveryStatus,
          deliveredAt: row.deliveredAt,
        },
        assignment: {
          status: 'RELEASED',
          acceptedAt: 'set',
          releasedAt: 'set',
          driverId: row.servingDriverId,
          deliveryId: row.deliveryId,
        },
        earning: {
          deliveryId: row.deliveryId,
          driverId: row.earningDriverId,
        },
        authenticatedDriverId: expectedDriverId,
      })
    ) {
      throw driverDeliveryHistoryIntegrity();
    }
    assertHistoryEarningOwnership({
      earning: {
        deliveryId: row.deliveryId,
        driverId: row.earningDriverId,
        status: row.earningStatus,
      },
      deliveryId: row.deliveryId,
      servingDriverId: expectedDriverId,
    });
    if (row.servingDriverId !== expectedDriverId) {
      throw driverDeliveryHistoryIntegrity();
    }
    const mapped = mapHistoryPublicFields({
      deliveryId: row.deliveryId,
      orderPublicReference: row.orderPublicReference,
      deliveryStatus: row.deliveryStatus,
      deliveredAt: row.deliveredAt,
      merchantName: row.merchantName,
      branchName: row.branchName,
      paymentMethod: row.paymentMethod,
      pickedUpAt: row.pickedUpAt,
      arrivedCustomerAt: row.arrivedCustomerAt,
      earningId: row.earningId,
      earningAmountMinor: this.history.serializeEarningAmount(
        row.earningAmountMinor,
      ),
      earningStatus: row.earningStatus,
      earnedAt: row.earnedAt,
      currency: this.history.currency(),
    });
    return mapped.list;
  }

  private toDetail(
    row: Parameters<DriverDeliveryHistoryService['toListItem']>[0],
    expectedDriverId: string,
  ): DriverDeliveryHistoryDetailView {
    const list = this.toListItem(row, expectedDriverId);
    const mapped = mapHistoryPublicFields({
      deliveryId: row.deliveryId,
      orderPublicReference: row.orderPublicReference,
      deliveryStatus: row.deliveryStatus,
      deliveredAt: row.deliveredAt,
      merchantName: row.merchantName,
      branchName: row.branchName,
      paymentMethod: row.paymentMethod,
      pickedUpAt: row.pickedUpAt,
      arrivedCustomerAt: row.arrivedCustomerAt,
      earningId: row.earningId,
      earningAmountMinor: this.history.serializeEarningAmount(
        row.earningAmountMinor,
      ),
      earningStatus: row.earningStatus,
      earnedAt: row.earnedAt,
      currency: this.history.currency(),
    });
    return {
      ...list,
      ...mapped.detailExtras,
    };
  }
}
