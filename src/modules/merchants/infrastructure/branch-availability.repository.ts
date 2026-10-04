import { Injectable } from '@nestjs/common';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import {
  pgNow,
  pgTimestamptz,
  pgVarchar,
} from '../../../infrastructure/database/pg-values';
import type {
  AvailabilityMode,
  AvailabilityReasonCode,
} from '../domain/branch-availability.constants';
import type { AvailabilityOverrideSnapshot } from '../domain/branch-availability.evaluator';

type OrmClient = {
  orm: SpeedyGoDb['orm'];
};

function orm(client: OrmClient) {
  return client.orm.public;
}

export type AvailabilityOverrideRecord = AvailabilityOverrideSnapshot & {
  id: string;
  branchId: string;
  updatedByAccountId: string;
  createdAt: string;
};

@Injectable()
export class BranchAvailabilityRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async findOwnedBranch(
    merchantId: string,
    branchId: string,
  ): Promise<{ id: string; merchantId: string } | null> {
    const row = await orm(this.db())
      .MerchantBranch.where({ id: branchId, merchantId })
      .first();
    return row ? { id: row.id, merchantId: row.merchantId } : null;
  }

  async findByBranchId(
    branchId: string,
  ): Promise<AvailabilityOverrideRecord | null> {
    const row = await orm(this.db())
      .MerchantBranchAvailabilityOverride.where({ branchId })
      .first();
    return row ? this.toRecord(row) : null;
  }

  async findByBranchIds(
    branchIds: string[],
  ): Promise<Map<string, AvailabilityOverrideRecord>> {
    const result = new Map<string, AvailabilityOverrideRecord>();
    if (branchIds.length === 0) return result;
    const rows = await orm(this.db())
      .MerchantBranchAvailabilityOverride.where((r) => r.branchId.in(branchIds))
      .all();
    for (const row of rows) {
      result.set(row.branchId, this.toRecord(row));
    }
    return result;
  }

  async create(input: {
    branchId: string;
    updatedByAccountId: string;
    mode: AvailabilityMode;
    reasonCode: AvailabilityReasonCode | null;
    customerMessage: string | null;
    closedUntil: Date | null;
  }): Promise<AvailabilityOverrideRecord> {
    const now = pgNow();
    const id = createUuidV7();
    await orm(this.db()).MerchantBranchAvailabilityOverride.create({
      id,
      branchId: input.branchId,
      mode: pgVarchar<32>(input.mode),
      reasonCode: input.reasonCode ? pgVarchar<64>(input.reasonCode) : null,
      customerMessage: input.customerMessage
        ? pgVarchar<500>(input.customerMessage)
        : null,
      closedUntil: input.closedUntil
        ? pgTimestamptz(input.closedUntil.toISOString())
        : null,
      version: 1,
      updatedByAccountId: input.updatedByAccountId,
      createdAt: now,
      updatedAt: now,
    });
    const created = await this.findByBranchId(input.branchId);
    if (!created) {
      throw new Error('Availability override create failed');
    }
    return created;
  }

  async update(input: {
    branchId: string;
    expectedVersion: number;
    updatedByAccountId: string;
    mode: AvailabilityMode;
    reasonCode: AvailabilityReasonCode | null;
    customerMessage: string | null;
    closedUntil: Date | null;
  }): Promise<AvailabilityOverrideRecord | null> {
    const now = pgNow();
    const ok = await this.db().transaction(async (tx) => {
      const existing = await orm(tx)
        .MerchantBranchAvailabilityOverride.where({
          branchId: input.branchId,
        })
        .first();
      if (!existing || existing.version !== input.expectedVersion) {
        return false;
      }
      await orm(tx)
        .MerchantBranchAvailabilityOverride.where({
          branchId: input.branchId,
          version: input.expectedVersion,
        })
        .update({
          mode: pgVarchar<32>(input.mode),
          reasonCode: input.reasonCode ? pgVarchar<64>(input.reasonCode) : null,
          customerMessage: input.customerMessage
            ? pgVarchar<500>(input.customerMessage)
            : null,
          closedUntil: input.closedUntil
            ? pgTimestamptz(input.closedUntil.toISOString())
            : null,
          version: input.expectedVersion + 1,
          updatedByAccountId: input.updatedByAccountId,
          updatedAt: now,
        });
      return true;
    });
    if (!ok) return null;
    return this.findByBranchId(input.branchId);
  }

  /**
   * Clear expired temporary to FOLLOW_SCHEDULE only if version matches and
   * closedUntil is still in the past (cannot erase a newer closure).
   */
  async clearExpiredTemporaryIfUnchanged(input: {
    branchId: string;
    expectedVersion: number;
    updatedByAccountId: string;
    now: Date;
  }): Promise<AvailabilityOverrideRecord | null> {
    const existing = await this.findByBranchId(input.branchId);
    if (!existing) return null;
    if (existing.version !== input.expectedVersion) return null;
    if (existing.mode !== 'TEMPORARY_CLOSED') return null;
    if (
      !existing.closedUntil ||
      existing.closedUntil.getTime() > input.now.getTime()
    ) {
      return null;
    }
    return this.update({
      branchId: input.branchId,
      expectedVersion: input.expectedVersion,
      updatedByAccountId: input.updatedByAccountId,
      mode: 'FOLLOW_SCHEDULE',
      reasonCode: null,
      customerMessage: null,
      closedUntil: null,
    });
  }

  private toRecord(row: {
    id: string;
    branchId: string;
    mode: string;
    reasonCode: string | null;
    customerMessage: string | null;
    closedUntil: string | null;
    version: number;
    updatedByAccountId: string;
    createdAt: string;
    updatedAt: string;
  }): AvailabilityOverrideRecord {
    return {
      id: row.id,
      branchId: row.branchId,
      mode: row.mode as AvailabilityMode,
      reasonCode: row.reasonCode as AvailabilityReasonCode | null,
      customerMessage: row.customerMessage,
      closedUntil: row.closedUntil ? new Date(row.closedUntil) : null,
      version: row.version,
      updatedByAccountId: row.updatedByAccountId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
