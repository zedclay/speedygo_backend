import { Injectable } from '@nestjs/common';
import { isPostgresUniqueViolation } from '../../../common/errors/postgres-unique';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import { consumeRawRows } from '../../../infrastructure/database/consume-query-rows';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import {
  pgBigInt,
  pgTimestamptz,
  pgVarchar,
} from '../../../infrastructure/database/pg-values';
import type { OrmClient } from '../../merchants/infrastructure/merchant.repository';

function orm(client: { orm: SpeedyGoDb['orm'] }) {
  return client.orm.public;
}

export type DuplicatedImage = {
  objectId: string;
  contentType: string;
  byteSize: number;
  widthPx: number;
  heightPx: number;
};

export type DuplicateProductOutcome =
  | {
      status: 'created';
      productId: string;
      optionGroupCount: number;
      optionCount: number;
      imageCopied: boolean;
    }
  | { status: 'source_missing' }
  | { status: 'duplicate_key' };

@Injectable()
export class ProductDuplicationRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async findByRequestKey(
    requestKey: string,
  ): Promise<{ id: string; merchantBranchId: string } | null> {
    const row = await orm(this.db())
      .Product.where({ duplicateRequestKey: pgVarchar<64>(requestKey) })
      .first();
    return row ? { id: row.id, merchantBranchId: row.merchantBranchId } : null;
  }

  async countCopiedConfiguration(productId: string): Promise<{
    optionGroupCount: number;
    optionCount: number;
    imageCopied: boolean;
  }> {
    const groups = await orm(this.db())
      .ProductOptionGroup.where({ productId })
      .all();
    const groupIds = groups.map((group) => group.id);
    const options =
      groupIds.length === 0
        ? []
        : await orm(this.db())
            .ProductOption.where((option) => option.optionGroupId.in(groupIds))
            .all();
    const image = await orm(this.db())
      .ProductImage.where({ productId })
      .first();
    return {
      optionGroupCount: groups.length,
      optionCount: options.length,
      imageCopied: image != null,
    };
  }

  /**
   * Deep-copies one Product in a single transaction. Source rows are read
   * under FOR SHARE and never written. The copy starts unavailable. A unique
   * violation on duplicate_request_key means the same request already won.
   */
  async duplicate(input: {
    sourceProductId: string;
    requestKey: string;
    name: string;
    image: DuplicatedImage | null;
  }): Promise<DuplicateProductOutcome> {
    try {
      return await this.db().transaction(async (tx: OrmClient) => {
        const locked = await this.lockSource(tx, input.sourceProductId);
        if (!locked) {
          return { status: 'source_missing' as const };
        }
        const source = await orm(tx)
          .Product.where({ id: input.sourceProductId })
          .first();
        if (!source) {
          return { status: 'source_missing' as const };
        }
        const groups = (
          await orm(tx).ProductOptionGroup.where({ productId: source.id }).all()
        )
          .slice()
          .sort(byCreatedThenId);
        const groupIds = groups.map((group) => group.id);
        const options = (
          groupIds.length === 0
            ? []
            : await orm(tx)
                .ProductOption.where((option) =>
                  option.optionGroupId.in(groupIds),
                )
                .all()
        )
          .slice()
          .sort(byCreatedThenId);

        const baseMs = Date.now();
        let tick = 0;
        const nextStamp = () =>
          pgTimestamptz(new Date(baseMs + tick++).toISOString());

        const productId = createUuidV7();
        const productStamp = nextStamp();
        await orm(tx).Product.create({
          id: productId,
          merchantBranchId: source.merchantBranchId,
          categoryId: source.categoryId,
          name: pgVarchar<255>(input.name),
          description: source.description ?? null,
          priceMinor: pgBigInt(source.priceMinor as bigint | number | string),
          available: false,
          sellingUnitCode: source.sellingUnitCode ?? null,
          sellingUnitLabelFr: source.sellingUnitLabelFr ?? null,
          duplicateRequestKey: pgVarchar<64>(input.requestKey),
          createdAt: productStamp,
          updatedAt: productStamp,
        });

        const groupIdMap = new Map<string, string>();
        for (const group of groups) {
          const newGroupId = createUuidV7();
          groupIdMap.set(group.id, newGroupId);
          const stamp = nextStamp();
          await orm(tx).ProductOptionGroup.create({
            id: newGroupId,
            productId,
            name: pgVarchar<255>(group.name),
            required: group.required,
            minSelections: group.minSelections,
            maxSelections: group.maxSelections,
            createdAt: stamp,
            updatedAt: stamp,
          });
        }

        for (const option of options) {
          const newGroupId = groupIdMap.get(option.optionGroupId);
          if (!newGroupId) {
            continue;
          }
          const stamp = nextStamp();
          await orm(tx).ProductOption.create({
            id: createUuidV7(),
            optionGroupId: newGroupId,
            name: pgVarchar<255>(option.name),
            additionalPriceMinor: pgBigInt(
              option.additionalPriceMinor as bigint | number | string,
            ),
            available: option.available,
            createdAt: stamp,
            updatedAt: stamp,
          });
        }

        if (input.image) {
          const stamp = nextStamp();
          await orm(tx).ProductImage.create({
            id: createUuidV7(),
            productId,
            objectId: pgVarchar<64>(input.image.objectId),
            contentType: pgVarchar<64>(input.image.contentType),
            byteSize: input.image.byteSize,
            widthPx: input.image.widthPx,
            heightPx: input.image.heightPx,
            createdAt: stamp,
            updatedAt: stamp,
          });
        }

        return {
          status: 'created' as const,
          productId,
          optionGroupCount: groups.length,
          optionCount: options.length,
          imageCopied: input.image != null,
        };
      });
    } catch (error) {
      if (isPostgresUniqueViolation(error)) {
        return { status: 'duplicate_key' };
      }
      throw error;
    }
  }

  private async lockSource(tx: OrmClient, productId: string): Promise<boolean> {
    if (typeof tx.query !== 'function') {
      throw new Error('Product duplication requires a transactional client');
    }
    const productPlan = this.db().raw.sql`
        SELECT id FROM products
        WHERE id = ${productId}::uuid
        FOR SHARE
      `
      .returnsRow({ id: 'pg/uuid@1' })
      .build();
    const rows = await consumeRawRows<{ id: string }>(tx.query(productPlan));
    if (rows.length === 0) {
      return false;
    }
    const groupPlan = this.db().raw.sql`
        SELECT id FROM product_option_groups
        WHERE product_id = ${productId}::uuid
        FOR SHARE
      `
      .returnsRow({ id: 'pg/uuid@1' })
      .build();
    await consumeRawRows(tx.query(groupPlan));
    const optionPlan = this.db().raw.sql`
        SELECT o.id
        FROM product_options o
        INNER JOIN product_option_groups g ON g.id = o.option_group_id
        WHERE g.product_id = ${productId}::uuid
        FOR SHARE OF o
      `
      .returnsRow({ id: 'pg/uuid@1' })
      .build();
    await consumeRawRows(tx.query(optionPlan));
    const imagePlan = this.db().raw.sql`
        SELECT id FROM product_images
        WHERE product_id = ${productId}::uuid
        FOR SHARE
      `
      .returnsRow({ id: 'pg/uuid@1' })
      .build();
    await consumeRawRows(tx.query(imagePlan));
    return true;
  }
}

function byCreatedThenId(
  a: { createdAt: string; id: string },
  b: { createdAt: string; id: string },
): number {
  return (
    String(a.createdAt).localeCompare(String(b.createdAt)) ||
    a.id.localeCompare(b.id)
  );
}
