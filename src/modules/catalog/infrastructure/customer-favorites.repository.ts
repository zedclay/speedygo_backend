import { Injectable } from '@nestjs/common';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import {
  CUSTOMER_FAVORITE_KIND_BRANCH,
  CUSTOMER_FAVORITE_KIND_PRODUCT,
  type CustomerFavoriteKind,
  type CustomerFavoriteRecord,
} from '../domain/customer-favorites.types';

@Injectable()
export class CustomerFavoritesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async insert(input: {
    customerId: string;
    targetKind: CustomerFavoriteKind;
    targetId: string;
    branchId: string;
  }): Promise<CustomerFavoriteRecord> {
    const id = createUuidV7();
    const db = this.db();
    const plan = db.raw.sql`
      INSERT INTO customer_favorites (
        id, customer_id, target_kind, target_id, branch_id, created_at
      )
      VALUES (
        ${id}::uuid,
        ${input.customerId}::uuid,
        ${input.targetKind},
        ${input.targetId}::uuid,
        ${input.branchId}::uuid,
        NOW()
      )
      ON CONFLICT (customer_id, target_kind, target_id) DO UPDATE
        SET branch_id = EXCLUDED.branch_id
      RETURNING
        id,
        customer_id,
        target_kind,
        target_id,
        branch_id,
        created_at::varchar AS created_at
    `
      .returnsRow({
        id: 'pg/uuid@1',
        customer_id: 'pg/uuid@1',
        target_kind: 'sql/varchar@1',
        target_id: 'pg/uuid@1',
        branch_id: 'pg/uuid@1',
        created_at: 'sql/varchar@1',
      })
      .build();
    for await (const row of db.runtime().query(plan)) {
      return this.toRecord(row);
    }
    throw new Error('customer_favorites insert returned no row');
  }

  async deleteOwned(input: {
    customerId: string;
    targetKind: CustomerFavoriteKind;
    targetId: string;
  }): Promise<boolean> {
    const db = this.db();
    const plan = db.raw.sql`
      DELETE FROM customer_favorites
      WHERE customer_id = ${input.customerId}::uuid
        AND target_kind = ${input.targetKind}
        AND target_id = ${input.targetId}::uuid
      RETURNING id
    `
      .returnsRow({ id: 'pg/uuid@1' })
      .build();
    for await (const row of db.runtime().query(plan)) {
      return Boolean(row.id);
    }
    return false;
  }

  async listOwned(input: {
    customerId: string;
    kind: CustomerFavoriteKind;
  }): Promise<CustomerFavoriteRecord[]> {
    const db = this.db();
    const plan = db.raw.sql`
      SELECT
        id,
        customer_id,
        target_kind,
        target_id,
        branch_id,
        created_at::varchar AS created_at
      FROM customer_favorites
      WHERE customer_id = ${input.customerId}::uuid
        AND target_kind = ${input.kind}
      ORDER BY created_at DESC, id DESC
    `
      .returnsRow({
        id: 'pg/uuid@1',
        customer_id: 'pg/uuid@1',
        target_kind: 'sql/varchar@1',
        target_id: 'pg/uuid@1',
        branch_id: 'pg/uuid@1',
        created_at: 'sql/varchar@1',
      })
      .build();
    const items: CustomerFavoriteRecord[] = [];
    for await (const row of db.runtime().query(plan)) {
      items.push(this.toRecord(row));
    }
    return items;
  }

  async listOwnedIds(customerId: string): Promise<{
    branchIds: string[];
    productIds: string[];
  }> {
    const db = this.db();
    const plan = db.raw.sql`
      SELECT target_kind, target_id
      FROM customer_favorites
      WHERE customer_id = ${customerId}::uuid
    `
      .returnsRow({
        target_kind: 'sql/varchar@1',
        target_id: 'pg/uuid@1',
      })
      .build();
    const branchIds: string[] = [];
    const productIds: string[] = [];
    for await (const row of db.runtime().query(plan)) {
      if (row.target_kind === CUSTOMER_FAVORITE_KIND_BRANCH) {
        branchIds.push(String(row.target_id));
      } else if (row.target_kind === CUSTOMER_FAVORITE_KIND_PRODUCT) {
        productIds.push(String(row.target_id));
      }
    }
    return { branchIds, productIds };
  }

  async findVisibleBranchId(branchId: string): Promise<string | null> {
    const db = this.db();
    const plan = db.raw.sql`
      SELECT b.id
      FROM merchant_branches b
      INNER JOIN merchants m ON m.id = b.merchant_id
      WHERE b.id = ${branchId}::uuid
        AND m.status = 'ACTIVE'
        AND m.verified_at IS NOT NULL
        AND length(btrim(m.name)) > 0
        AND b.operational_status = 'ACTIVE'
    `
      .returnsRow({ id: 'pg/uuid@1' })
      .build();
    for await (const row of db.runtime().query(plan)) {
      return String(row.id);
    }
    return null;
  }

  async findVisibleProduct(input: {
    productId: string;
  }): Promise<{ productId: string; branchId: string } | null> {
    const db = this.db();
    const plan = db.raw.sql`
      SELECT p.id AS product_id, b.id AS branch_id
      FROM products p
      INNER JOIN categories c ON c.id = p.category_id
      INNER JOIN merchant_branches b ON b.id = p.merchant_branch_id
      INNER JOIN merchants m ON m.id = b.merchant_id
      WHERE p.id = ${input.productId}::uuid
        AND m.status = 'ACTIVE'
        AND m.verified_at IS NOT NULL
        AND length(btrim(m.name)) > 0
        AND b.operational_status = 'ACTIVE'
        AND c.active = true
        AND p.available = true
    `
      .returnsRow({
        product_id: 'pg/uuid@1',
        branch_id: 'pg/uuid@1',
      })
      .build();
    for await (const row of db.runtime().query(plan)) {
      return {
        productId: String(row.product_id),
        branchId: String(row.branch_id),
      };
    }
    return null;
  }

  private toRecord(row: {
    id: unknown;
    customer_id: unknown;
    target_kind: unknown;
    target_id: unknown;
    branch_id: unknown;
    created_at: unknown;
  }): CustomerFavoriteRecord {
    const kind = String(row.target_kind);
    return {
      id: String(row.id),
      customerId: String(row.customer_id),
      targetKind:
        kind === CUSTOMER_FAVORITE_KIND_PRODUCT
          ? CUSTOMER_FAVORITE_KIND_PRODUCT
          : CUSTOMER_FAVORITE_KIND_BRANCH,
      targetId: String(row.target_id),
      branchId: String(row.branch_id),
      createdAt: String(row.created_at),
    };
  }
}
