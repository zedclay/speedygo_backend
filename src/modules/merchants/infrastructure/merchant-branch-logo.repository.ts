import { Injectable } from '@nestjs/common';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import { pgNow, pgVarchar } from '../../../infrastructure/database/pg-values';
import { consumeRawRows } from '../../../infrastructure/database/consume-query-rows';
import type { OrmClient } from './merchant.repository';

export type MerchantBranchLogoRecord = {
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

function toLogo(row: {
  id: string;
  branchId: string;
  objectId: string;
  contentType: string;
  byteSize: number;
  widthPx: number;
  heightPx: number;
  createdAt: string;
  updatedAt: string;
}): MerchantBranchLogoRecord {
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
export class MerchantBranchLogoRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async findByBranch(
    branchId: string,
    client?: OrmClient,
  ): Promise<MerchantBranchLogoRecord | null> {
    const row = await orm(client ?? this.db())
      .MerchantBranchLogo.where({ branchId })
      .first();
    return row ? toLogo(row) : null;
  }

  async findByObjectId(
    objectId: string,
    client?: OrmClient,
  ): Promise<MerchantBranchLogoRecord | null> {
    const row = await orm(client ?? this.db())
      .MerchantBranchLogo.where({ objectId: pgVarchar<64>(objectId) })
      .first();
    return row ? toLogo(row) : null;
  }

  /**
   * Replaces the branch logo under a branch row lock so concurrent binds
   * serialize and each caller learns the object it actually replaced.
   */
  async upsert(input: {
    branchId: string;
    objectId: string;
    contentType: string;
    byteSize: number;
    widthPx: number;
    heightPx: number;
  }): Promise<{
    previous: MerchantBranchLogoRecord | null;
    current: MerchantBranchLogoRecord;
  }> {
    return this.db().transaction(async (tx: OrmClient) => {
      await this.lockBranch(tx, input.branchId);
      const existing = await this.findByBranch(input.branchId, tx);
      const now = pgNow();
      if (existing) {
        await orm(tx)
          .MerchantBranchLogo.where({ id: existing.id })
          .update({
            objectId: pgVarchar<64>(input.objectId),
            contentType: pgVarchar<64>(input.contentType),
            byteSize: input.byteSize,
            widthPx: input.widthPx,
            heightPx: input.heightPx,
            updatedAt: now,
          });
        const current = await this.findByBranch(input.branchId, tx);
        return { previous: existing, current: current! };
      }
      const created = await orm(tx).MerchantBranchLogo.create({
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
      return { previous: null, current: toLogo(created) };
    });
  }

  async deleteByBranch(
    branchId: string,
  ): Promise<MerchantBranchLogoRecord | null> {
    return this.db().transaction(async (tx: OrmClient) => {
      await this.lockBranch(tx, branchId);
      const existing = await this.findByBranch(branchId, tx);
      if (!existing) {
        return null;
      }
      await orm(tx).MerchantBranchLogo.where({ id: existing.id }).delete();
      return existing;
    });
  }

  private async lockBranch(tx: OrmClient, branchId: string): Promise<void> {
    if (typeof tx.query !== 'function') {
      throw new Error('Merchant branch logo requires a transactional client');
    }
    const plan = this.db().raw.sql`
        SELECT id FROM merchant_branches
        WHERE id = ${branchId}::uuid
        FOR NO KEY UPDATE
      `
      .returnsRow({ id: 'pg/uuid@1' })
      .build();
    await consumeRawRows(tx.query(plan));
  }
}
