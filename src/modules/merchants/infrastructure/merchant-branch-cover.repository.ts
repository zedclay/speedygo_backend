import { Injectable } from '@nestjs/common';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import { pgNow, pgVarchar } from '../../../infrastructure/database/pg-values';
import type { OrmClient } from './merchant.repository';

export type MerchantBranchCoverRecord = {
  id: string;
  branchId: string;
  objectId: string;
  contentType: string;
  byteSize: number;
  widthPx: number;
  heightPx: number;
  createdAt: string;
  updatedAt: string;
};

function orm(client: { orm: SpeedyGoDb['orm'] }) {
  return client.orm.public;
}

function toCover(row: {
  id: string;
  branchId: string;
  objectId: string;
  contentType: string;
  byteSize: number;
  widthPx: number;
  heightPx: number;
  createdAt: string;
  updatedAt: string;
}): MerchantBranchCoverRecord {
  return {
    id: row.id,
    branchId: row.branchId,
    objectId: String(row.objectId),
    contentType: String(row.contentType),
    byteSize: Number(row.byteSize),
    widthPx: Number(row.widthPx),
    heightPx: Number(row.heightPx),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class MerchantBranchCoverRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async findByBranch(
    branchId: string,
    client?: OrmClient,
  ): Promise<MerchantBranchCoverRecord | null> {
    const row = await orm(client ?? this.db())
      .MerchantBranchCover.where({ branchId })
      .first();
    return row ? toCover(row) : null;
  }

  async findByObjectId(
    objectId: string,
    client?: OrmClient,
  ): Promise<MerchantBranchCoverRecord | null> {
    const row = await orm(client ?? this.db())
      .MerchantBranchCover.where({ objectId: pgVarchar<64>(objectId) })
      .first();
    return row ? toCover(row) : null;
  }

  async upsert(
    input: {
      branchId: string;
      objectId: string;
      contentType: string;
      byteSize: number;
      widthPx: number;
      heightPx: number;
    },
    client?: OrmClient,
  ): Promise<{
    previous: MerchantBranchCoverRecord | null;
    current: MerchantBranchCoverRecord;
  }> {
    const existing = await this.findByBranch(input.branchId, client);
    const now = pgNow();
    if (existing) {
      await orm(client ?? this.db())
        .MerchantBranchCover.where({ id: existing.id })
        .update({
          objectId: pgVarchar<64>(input.objectId),
          contentType: pgVarchar<64>(input.contentType),
          byteSize: input.byteSize,
          widthPx: input.widthPx,
          heightPx: input.heightPx,
          updatedAt: now,
        });
      const current = await this.findByBranch(input.branchId, client);
      return { previous: existing, current: current! };
    }
    const created = await orm(client ?? this.db()).MerchantBranchCover.create({
      id: createUuidV7(),
      branchId: input.branchId,
      objectId: pgVarchar<64>(input.objectId),
      contentType: pgVarchar<64>(input.contentType),
      byteSize: input.byteSize,
      widthPx: input.widthPx,
      heightPx: input.heightPx,
      createdAt: now,
      updatedAt: now,
    });
    return { previous: null, current: toCover(created) };
  }

  async deleteByBranch(
    branchId: string,
    client?: OrmClient,
  ): Promise<MerchantBranchCoverRecord | null> {
    const existing = await this.findByBranch(branchId, client);
    if (!existing) {
      return null;
    }
    await orm(client ?? this.db())
      .MerchantBranchCover.where({ id: existing.id })
      .delete();
    return existing;
  }
}
