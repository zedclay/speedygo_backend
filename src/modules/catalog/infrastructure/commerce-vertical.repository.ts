import { Injectable } from '@nestjs/common';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import { pgNow, pgVarchar } from '../../../infrastructure/database/pg-values';
import type { OrmClient } from '../../admin/application/admin-audit.service';
import type {
  CommerceVerticalRecord,
  MerchantBranchClassificationRecord,
} from '../domain/commerce-vertical.types';

function orm(client: { orm: SpeedyGoDb['orm'] }) {
  return client.orm.public;
}

function toVertical(row: {
  id: string;
  slug: string;
  name: string;
  iconKey: string;
  sortOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}): CommerceVerticalRecord {
  return {
    id: row.id,
    slug: String(row.slug),
    name: String(row.name),
    iconKey: String(row.iconKey),
    sortOrder: Number(row.sortOrder),
    active: Boolean(row.active),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toClassification(row: {
  id: string;
  branchId: string;
  verticalId: string;
  createdAt: string;
  updatedAt: string;
}): MerchantBranchClassificationRecord {
  return {
    id: row.id,
    branchId: row.branchId,
    verticalId: row.verticalId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class CommerceVerticalRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async listAll(client?: OrmClient): Promise<CommerceVerticalRecord[]> {
    const rows = await orm(client ?? this.db())
      .CommerceVertical.orderBy((row) => row.sortOrder.asc())
      .all();
    return rows.map(toVertical).sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }
      return a.slug.localeCompare(b.slug);
    });
  }

  async listActive(): Promise<CommerceVerticalRecord[]> {
    const rows = await orm(this.db())
      .CommerceVertical.where({ active: true })
      .orderBy((row) => row.sortOrder.asc())
      .all();
    return rows.map(toVertical).sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }
      return a.slug.localeCompare(b.slug);
    });
  }

  async findById(
    id: string,
    client?: OrmClient,
  ): Promise<CommerceVerticalRecord | null> {
    const row = await orm(client ?? this.db())
      .CommerceVertical.where({ id })
      .first();
    return row ? toVertical(row) : null;
  }

  async findBySlug(
    slug: string,
    client?: OrmClient,
  ): Promise<CommerceVerticalRecord | null> {
    const row = await orm(client ?? this.db())
      .CommerceVertical.where({ slug: pgVarchar<64>(slug) })
      .first();
    return row ? toVertical(row) : null;
  }

  async create(
    input: {
      slug: string;
      name: string;
      iconKey: string;
      sortOrder: number;
      active: boolean;
    },
    client?: OrmClient,
  ): Promise<CommerceVerticalRecord> {
    const now = pgNow();
    const created = await orm(client ?? this.db()).CommerceVertical.create({
      id: createUuidV7(),
      slug: pgVarchar<64>(input.slug),
      name: pgVarchar<255>(input.name),
      iconKey: pgVarchar<64>(input.iconKey),
      sortOrder: input.sortOrder,
      active: input.active,
      createdAt: now,
      updatedAt: now,
    });
    return toVertical(created);
  }

  async update(
    id: string,
    patch: {
      name?: string;
      iconKey?: string;
      sortOrder?: number;
      active?: boolean;
    },
    client?: OrmClient,
  ): Promise<CommerceVerticalRecord> {
    await orm(client ?? this.db())
      .CommerceVertical.where({ id })
      .update({
        ...(patch.name !== undefined
          ? { name: pgVarchar<255>(patch.name) }
          : {}),
        ...(patch.iconKey !== undefined
          ? { iconKey: pgVarchar<64>(patch.iconKey) }
          : {}),
        ...(patch.sortOrder !== undefined
          ? { sortOrder: patch.sortOrder }
          : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
        updatedAt: pgNow(),
      });
    const row = await this.findById(id, client);
    if (!row) {
      throw new Error('CommerceVertical missing after update');
    }
    return row;
  }

  async findClassificationByBranch(
    branchId: string,
    client?: OrmClient,
  ): Promise<MerchantBranchClassificationRecord | null> {
    const row = await orm(client ?? this.db())
      .MerchantBranchClassification.where({ branchId })
      .first();
    return row ? toClassification(row) : null;
  }

  async upsertClassification(
    branchId: string,
    verticalId: string,
    client?: OrmClient,
  ): Promise<MerchantBranchClassificationRecord> {
    const existing = await this.findClassificationByBranch(branchId, client);
    const now = pgNow();
    if (existing) {
      await orm(client ?? this.db())
        .MerchantBranchClassification.where({ id: existing.id })
        .update({ verticalId, updatedAt: now });
      const row = await this.findClassificationByBranch(branchId, client);
      if (!row) {
        throw new Error('Classification missing after update');
      }
      return row;
    }
    const created = await orm(
      client ?? this.db(),
    ).MerchantBranchClassification.create({
      id: createUuidV7(),
      branchId,
      verticalId,
      createdAt: now,
      updatedAt: now,
    });
    return toClassification(created);
  }

  async deleteClassification(
    branchId: string,
    client?: OrmClient,
  ): Promise<MerchantBranchClassificationRecord | null> {
    const existing = await this.findClassificationByBranch(branchId, client);
    if (!existing) {
      return null;
    }
    await orm(client ?? this.db())
      .MerchantBranchClassification.where({ id: existing.id })
      .delete();
    return existing;
  }
}
