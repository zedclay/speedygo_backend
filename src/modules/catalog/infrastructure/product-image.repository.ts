import { Injectable } from '@nestjs/common';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import { pgNow, pgVarchar } from '../../../infrastructure/database/pg-values';
import type { OrmClient } from '../../merchants/infrastructure/merchant.repository';

export type ProductImageRecord = {
  id: string;
  productId: string;
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

function toImage(row: {
  id: string;
  productId: string;
  objectId: string;
  contentType: string;
  byteSize: number;
  widthPx: number;
  heightPx: number;
  createdAt: string;
  updatedAt: string;
}): ProductImageRecord {
  return {
    id: row.id,
    productId: row.productId,
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
export class ProductImageRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async findByProduct(
    productId: string,
    client?: OrmClient,
  ): Promise<ProductImageRecord | null> {
    const row = await orm(client ?? this.db())
      .ProductImage.where({ productId })
      .first();
    return row ? toImage(row) : null;
  }

  async findByObjectId(
    objectId: string,
    client?: OrmClient,
  ): Promise<ProductImageRecord | null> {
    const row = await orm(client ?? this.db())
      .ProductImage.where({ objectId: pgVarchar<64>(objectId) })
      .first();
    return row ? toImage(row) : null;
  }

  async upsert(
    input: {
      productId: string;
      objectId: string;
      contentType: string;
      byteSize: number;
      widthPx: number;
      heightPx: number;
    },
    client?: OrmClient,
  ): Promise<{
    previous: ProductImageRecord | null;
    current: ProductImageRecord;
  }> {
    const existing = await this.findByProduct(input.productId, client);
    const now = pgNow();
    if (existing) {
      await orm(client ?? this.db())
        .ProductImage.where({ id: existing.id })
        .update({
          objectId: pgVarchar<64>(input.objectId),
          contentType: pgVarchar<64>(input.contentType),
          byteSize: input.byteSize,
          widthPx: input.widthPx,
          heightPx: input.heightPx,
          updatedAt: now,
        });
      const current = await this.findByProduct(input.productId, client);
      return { previous: existing, current: current! };
    }
    const created = await orm(client ?? this.db()).ProductImage.create({
      id: createUuidV7(),
      productId: input.productId,
      objectId: pgVarchar<64>(input.objectId),
      contentType: pgVarchar<64>(input.contentType),
      byteSize: input.byteSize,
      widthPx: input.widthPx,
      heightPx: input.heightPx,
      createdAt: now,
      updatedAt: now,
    });
    return { previous: null, current: toImage(created) };
  }

  async deleteByProduct(
    productId: string,
    client?: OrmClient,
  ): Promise<ProductImageRecord | null> {
    const existing = await this.findByProduct(productId, client);
    if (!existing) {
      return null;
    }
    await orm(client ?? this.db())
      .ProductImage.where({ id: existing.id })
      .delete();
    return existing;
  }

  async findProductIdsWithImages(
    productIds: string[],
    client?: OrmClient,
  ): Promise<Set<string>> {
    const unique = [
      ...new Set(productIds.filter((id) => id.trim().length > 0)),
    ];
    if (unique.length === 0) {
      return new Set();
    }
    const rows = await orm(client ?? this.db())
      .ProductImage.where((image) => image.productId.in(unique))
      .all();
    return new Set(rows.map((row) => String(row.productId)));
  }
}
