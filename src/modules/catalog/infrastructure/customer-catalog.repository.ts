import { Injectable } from '@nestjs/common';
import { moneyMinorToDecimalString } from '../../../common/money/money-minor';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import { customerSearchQueryInvalid } from '../domain/customer-catalog.errors';
import { CUSTOMER_CATALOG_SEARCH_MIN_LENGTH } from '../domain/customer-catalog.policy';
import type {
  CustomerCatalogPage,
  CustomerCategorySummary,
  CustomerProductDetail,
  CustomerProductOptionGroup,
  CustomerProductSummary,
} from '../domain/customer-catalog.types';

/** Storefront row before opening-hours enrichment. */
export type CustomerStorefrontBase = Omit<
  import('../domain/customer-catalog.types').CustomerStorefrontSummary,
  | 'hoursConfigured'
  | 'isOpenNow'
  | 'timezone'
  | 'currentClosesAt'
  | 'nextOpenAt'
>;

type CustomerCatalogSearchHitBase =
  | {
      type: 'STOREFRONT';
      storefront: CustomerStorefrontBase;
    }
  | {
      type: 'PRODUCT';
      product: CustomerProductSummary;
      storefront: CustomerStorefrontBase;
    };

function orm(client: { orm: SpeedyGoDb['orm'] }) {
  return client.orm.public;
}

@Injectable()
export class CustomerCatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async findProfileIdByAccountId(accountId: string): Promise<string | null> {
    const row = await orm(this.db())
      .CustomerProfile.where({ accountId })
      .first();
    return row?.id ?? null;
  }

  async listStorefronts(input: {
    limit: number;
    offset: number;
  }): Promise<CustomerCatalogPage<CustomerStorefrontBase>> {
    const db = this.db();
    const countPlan = db.raw.sql`
        SELECT COUNT(*)::int8 AS total
        FROM merchant_branches b
        INNER JOIN merchants m ON m.id = b.merchant_id
        WHERE m.status = 'ACTIVE'
          AND m.verified_at IS NOT NULL
          AND length(btrim(m.name)) > 0
          AND b.operational_status = 'ACTIVE'
      `
      .returnsRow({ total: 'pg/int8@1' })
      .build();

    let total = 0;
    for await (const row of db.runtime().query(countPlan)) {
      total = Number(row.total);
    }

    const pagePlan = db.raw.sql`
        SELECT
          b.id AS branch_id,
          b.name AS branch_name,
          b.address_text::varchar AS address_text,
          b.latitude,
          b.longitude,
          m.id AS merchant_id,
          m.name AS merchant_name,
          m.public_reference
        FROM merchant_branches b
        INNER JOIN merchants m ON m.id = b.merchant_id
        WHERE m.status = 'ACTIVE'
          AND m.verified_at IS NOT NULL
          AND length(btrim(m.name)) > 0
          AND b.operational_status = 'ACTIVE'
        ORDER BY b.name ASC, b.id ASC
        LIMIT ${input.limit} OFFSET ${input.offset}
      `
      .returnsRow({
        branch_id: 'pg/uuid@1',
        branch_name: 'sql/varchar@1',
        address_text: 'sql/varchar@1',
        latitude: 'pg/numeric@1',
        longitude: 'pg/numeric@1',
        merchant_id: 'pg/uuid@1',
        merchant_name: 'sql/varchar@1',
        public_reference: 'sql/varchar@1',
      })
      .build();

    const items: CustomerStorefrontBase[] = [];
    for await (const row of db.runtime().query(pagePlan)) {
      items.push(this.toStorefront(row));
    }
    return { items, total, limit: input.limit, offset: input.offset };
  }

  async findVisibleStorefront(
    branchId: string,
  ): Promise<CustomerStorefrontBase | null> {
    const db = this.db();
    const plan = db.raw.sql`
        SELECT
          b.id AS branch_id,
          b.name AS branch_name,
          b.address_text::varchar AS address_text,
          b.latitude,
          b.longitude,
          m.id AS merchant_id,
          m.name AS merchant_name,
          m.public_reference
        FROM merchant_branches b
        INNER JOIN merchants m ON m.id = b.merchant_id
        WHERE b.id = ${branchId}::uuid
          AND m.status = 'ACTIVE'
          AND m.verified_at IS NOT NULL
          AND length(btrim(m.name)) > 0
          AND b.operational_status = 'ACTIVE'
        LIMIT 1
      `
      .returnsRow({
        branch_id: 'pg/uuid@1',
        branch_name: 'sql/varchar@1',
        address_text: 'sql/varchar@1',
        latitude: 'pg/numeric@1',
        longitude: 'pg/numeric@1',
        merchant_id: 'pg/uuid@1',
        merchant_name: 'sql/varchar@1',
        public_reference: 'sql/varchar@1',
      })
      .build();

    for await (const row of db.runtime().query(plan)) {
      return this.toStorefront(row);
    }
    return null;
  }

  async listVisibleCategories(
    branchId: string,
  ): Promise<CustomerCategorySummary[]> {
    const db = this.db();
    const plan = db.raw.sql`
        SELECT c.id AS category_id, c.name, c.sort_order
        FROM categories c
        INNER JOIN merchant_branches b ON b.id = c.merchant_branch_id
        INNER JOIN merchants m ON m.id = b.merchant_id
        WHERE c.merchant_branch_id = ${branchId}::uuid
          AND c.active = true
          AND m.status = 'ACTIVE'
          AND m.verified_at IS NOT NULL
          AND length(btrim(m.name)) > 0
          AND b.operational_status = 'ACTIVE'
          AND EXISTS (
            SELECT 1 FROM products p
            WHERE p.category_id = c.id
              AND p.available = true
          )
        ORDER BY c.sort_order ASC, c.created_at ASC, c.id ASC
      `
      .returnsRow({
        category_id: 'pg/uuid@1',
        name: 'sql/varchar@1',
        sort_order: 'pg/int4@1',
      })
      .build();

    const items: CustomerCategorySummary[] = [];
    for await (const row of db.runtime().query(plan)) {
      items.push({
        categoryId: String(row.category_id),
        name: String(row.name),
        sortOrder: Number(row.sort_order),
      });
    }
    return items;
  }

  async listVisibleProducts(input: {
    branchId: string;
    categoryId?: string;
    limit: number;
    offset: number;
  }): Promise<CustomerCatalogPage<CustomerProductSummary>> {
    if (input.categoryId !== undefined) {
      return this.listVisibleProductsInCategory({
        branchId: input.branchId,
        categoryId: input.categoryId,
        limit: input.limit,
        offset: input.offset,
      });
    }
    return this.listVisibleProductsAllCategories({
      branchId: input.branchId,
      limit: input.limit,
      offset: input.offset,
    });
  }

  private async listVisibleProductsAllCategories(input: {
    branchId: string;
    limit: number;
    offset: number;
  }): Promise<CustomerCatalogPage<CustomerProductSummary>> {
    const db = this.db();
    const countPlan = db.raw.sql`
        SELECT COUNT(*)::int8 AS total
        FROM products p
        INNER JOIN categories c ON c.id = p.category_id
        INNER JOIN merchant_branches b ON b.id = p.merchant_branch_id
        INNER JOIN merchants m ON m.id = b.merchant_id
        WHERE p.merchant_branch_id = ${input.branchId}::uuid
          AND m.status = 'ACTIVE'
          AND m.verified_at IS NOT NULL
          AND length(btrim(m.name)) > 0
          AND b.operational_status = 'ACTIVE'
          AND c.active = true
          AND p.available = true
      `
      .returnsRow({ total: 'pg/int8@1' })
      .build();

    let total = 0;
    for await (const row of db.runtime().query(countPlan)) {
      total = Number(row.total);
    }

    const pagePlan = db.raw.sql`
        SELECT
          p.id AS product_id,
          p.merchant_branch_id AS branch_id,
          p.category_id,
          p.name,
          p.description::varchar AS description,
          p.price_minor
        FROM products p
        INNER JOIN categories c ON c.id = p.category_id
        INNER JOIN merchant_branches b ON b.id = p.merchant_branch_id
        INNER JOIN merchants m ON m.id = b.merchant_id
        WHERE p.merchant_branch_id = ${input.branchId}::uuid
          AND m.status = 'ACTIVE'
          AND m.verified_at IS NOT NULL
          AND length(btrim(m.name)) > 0
          AND b.operational_status = 'ACTIVE'
          AND c.active = true
          AND p.available = true
        ORDER BY p.name ASC, p.id ASC
        LIMIT ${input.limit} OFFSET ${input.offset}
      `
      .returnsRow({
        product_id: 'pg/uuid@1',
        branch_id: 'pg/uuid@1',
        category_id: 'pg/uuid@1',
        name: 'sql/varchar@1',
        description: { codecId: 'sql/varchar@1', nullable: true },
        price_minor: 'pg/int8@1',
      })
      .build();

    const items: CustomerProductSummary[] = [];
    for await (const row of db.runtime().query(pagePlan)) {
      items.push(this.toProduct(row));
    }
    return { items, total, limit: input.limit, offset: input.offset };
  }

  private async listVisibleProductsInCategory(input: {
    branchId: string;
    categoryId: string;
    limit: number;
    offset: number;
  }): Promise<CustomerCatalogPage<CustomerProductSummary>> {
    const db = this.db();
    const countPlan = db.raw.sql`
        SELECT COUNT(*)::int8 AS total
        FROM products p
        INNER JOIN categories c ON c.id = p.category_id
        INNER JOIN merchant_branches b ON b.id = p.merchant_branch_id
        INNER JOIN merchants m ON m.id = b.merchant_id
        WHERE p.merchant_branch_id = ${input.branchId}::uuid
          AND p.category_id = ${input.categoryId}::uuid
          AND m.status = 'ACTIVE'
          AND m.verified_at IS NOT NULL
          AND length(btrim(m.name)) > 0
          AND b.operational_status = 'ACTIVE'
          AND c.active = true
          AND p.available = true
      `
      .returnsRow({ total: 'pg/int8@1' })
      .build();

    let total = 0;
    for await (const row of db.runtime().query(countPlan)) {
      total = Number(row.total);
    }

    const pagePlan = db.raw.sql`
        SELECT
          p.id AS product_id,
          p.merchant_branch_id AS branch_id,
          p.category_id,
          p.name,
          p.description::varchar AS description,
          p.price_minor
        FROM products p
        INNER JOIN categories c ON c.id = p.category_id
        INNER JOIN merchant_branches b ON b.id = p.merchant_branch_id
        INNER JOIN merchants m ON m.id = b.merchant_id
        WHERE p.merchant_branch_id = ${input.branchId}::uuid
          AND p.category_id = ${input.categoryId}::uuid
          AND m.status = 'ACTIVE'
          AND m.verified_at IS NOT NULL
          AND length(btrim(m.name)) > 0
          AND b.operational_status = 'ACTIVE'
          AND c.active = true
          AND p.available = true
        ORDER BY p.name ASC, p.id ASC
        LIMIT ${input.limit} OFFSET ${input.offset}
      `
      .returnsRow({
        product_id: 'pg/uuid@1',
        branch_id: 'pg/uuid@1',
        category_id: 'pg/uuid@1',
        name: 'sql/varchar@1',
        description: { codecId: 'sql/varchar@1', nullable: true },
        price_minor: 'pg/int8@1',
      })
      .build();

    const items: CustomerProductSummary[] = [];
    for await (const row of db.runtime().query(pagePlan)) {
      items.push(this.toProduct(row));
    }
    return { items, total, limit: input.limit, offset: input.offset };
  }

  async findVisibleProductDetail(
    branchId: string,
    productId: string,
  ): Promise<CustomerProductDetail | null> {
    const db = this.db();
    const plan = db.raw.sql`
        SELECT
          p.id AS product_id,
          p.merchant_branch_id AS branch_id,
          p.category_id,
          p.name,
          p.description::varchar AS description,
          p.price_minor
        FROM products p
        INNER JOIN categories c ON c.id = p.category_id
        INNER JOIN merchant_branches b ON b.id = p.merchant_branch_id
        INNER JOIN merchants m ON m.id = b.merchant_id
        WHERE p.id = ${productId}::uuid
          AND p.merchant_branch_id = ${branchId}::uuid
          AND m.status = 'ACTIVE'
          AND m.verified_at IS NOT NULL
          AND length(btrim(m.name)) > 0
          AND b.operational_status = 'ACTIVE'
          AND c.active = true
          AND p.available = true
        LIMIT 1
      `
      .returnsRow({
        product_id: 'pg/uuid@1',
        branch_id: 'pg/uuid@1',
        category_id: 'pg/uuid@1',
        name: 'sql/varchar@1',
        description: { codecId: 'sql/varchar@1', nullable: true },
        price_minor: 'pg/int8@1',
      })
      .build();

    let product: CustomerProductSummary | null = null;
    for await (const row of db.runtime().query(plan)) {
      product = this.toProduct(row);
    }
    if (!product) {
      return null;
    }

    const optionGroups = await this.loadOptionGroups(product.productId);
    return { ...product, optionGroups };
  }

  async search(input: {
    query: string;
    limit: number;
    offset: number;
  }): Promise<CustomerCatalogPage<CustomerCatalogSearchHitBase>> {
    // Defense in depth: service must normalize first; never run ILIKE '%%'.
    if (
      input.query.length < CUSTOMER_CATALOG_SEARCH_MIN_LENGTH ||
      /[%_\\]/.test(input.query)
    ) {
      throw customerSearchQueryInvalid(
        'Search query must be normalized before repository execution',
      );
    }
    const db = this.db();
    const like = `%${input.query}%`;

    const countPlan = db.raw.sql`
        SELECT COUNT(*)::int8 AS total FROM (
          SELECT b.id AS hit_id
          FROM merchant_branches b
          INNER JOIN merchants m ON m.id = b.merchant_id
          WHERE m.status = 'ACTIVE'
            AND m.verified_at IS NOT NULL
            AND length(btrim(m.name)) > 0
            AND b.operational_status = 'ACTIVE'
            AND (
              b.name ILIKE ${like}
              OR m.name ILIKE ${like}
            )
          UNION ALL
          SELECT p.id AS hit_id
          FROM products p
          INNER JOIN categories c ON c.id = p.category_id
          INNER JOIN merchant_branches b ON b.id = p.merchant_branch_id
          INNER JOIN merchants m ON m.id = b.merchant_id
          WHERE m.status = 'ACTIVE'
            AND m.verified_at IS NOT NULL
            AND length(btrim(m.name)) > 0
            AND b.operational_status = 'ACTIVE'
            AND c.active = true
            AND p.available = true
            AND p.name ILIKE ${like}
        ) hits
      `
      .returnsRow({ total: 'pg/int8@1' })
      .build();

    let total = 0;
    for await (const row of db.runtime().query(countPlan)) {
      total = Number(row.total);
    }

    const pagePlan = db.raw.sql`
        SELECT * FROM (
          SELECT
            'STOREFRONT'::varchar AS hit_type,
            b.name AS sort_name,
            b.id AS sort_id,
            b.id AS branch_id,
            b.name AS branch_name,
            b.address_text::varchar AS address_text,
            b.latitude,
            b.longitude,
            m.id AS merchant_id,
            m.name AS merchant_name,
            m.public_reference,
            NULL::uuid AS product_id,
            NULL::uuid AS category_id,
            NULL::varchar AS product_name,
            NULL::varchar AS product_description,
            NULL::int8 AS price_minor
          FROM merchant_branches b
          INNER JOIN merchants m ON m.id = b.merchant_id
          WHERE m.status = 'ACTIVE'
            AND m.verified_at IS NOT NULL
            AND length(btrim(m.name)) > 0
            AND b.operational_status = 'ACTIVE'
            AND (
              b.name ILIKE ${like}
              OR m.name ILIKE ${like}
            )
          UNION ALL
          SELECT
            'PRODUCT'::varchar AS hit_type,
            p.name AS sort_name,
            p.id AS sort_id,
            b.id AS branch_id,
            b.name AS branch_name,
            b.address_text::varchar AS address_text,
            b.latitude,
            b.longitude,
            m.id AS merchant_id,
            m.name AS merchant_name,
            m.public_reference,
            p.id AS product_id,
            p.category_id,
            p.name AS product_name,
            p.description::varchar AS product_description,
            p.price_minor
          FROM products p
          INNER JOIN categories c ON c.id = p.category_id
          INNER JOIN merchant_branches b ON b.id = p.merchant_branch_id
          INNER JOIN merchants m ON m.id = b.merchant_id
          WHERE m.status = 'ACTIVE'
            AND m.verified_at IS NOT NULL
            AND length(btrim(m.name)) > 0
            AND b.operational_status = 'ACTIVE'
            AND c.active = true
            AND p.available = true
            AND p.name ILIKE ${like}
        ) hits
        ORDER BY hit_type ASC, sort_name ASC, sort_id ASC
        LIMIT ${input.limit} OFFSET ${input.offset}
      `
      .returnsRow({
        hit_type: 'sql/varchar@1',
        sort_name: 'sql/varchar@1',
        sort_id: 'pg/uuid@1',
        branch_id: 'pg/uuid@1',
        branch_name: 'sql/varchar@1',
        address_text: 'sql/varchar@1',
        latitude: 'pg/numeric@1',
        longitude: 'pg/numeric@1',
        merchant_id: 'pg/uuid@1',
        merchant_name: 'sql/varchar@1',
        public_reference: 'sql/varchar@1',
        product_id: { codecId: 'pg/uuid@1', nullable: true },
        category_id: { codecId: 'pg/uuid@1', nullable: true },
        product_name: { codecId: 'sql/varchar@1', nullable: true },
        product_description: { codecId: 'sql/varchar@1', nullable: true },
        price_minor: { codecId: 'pg/int8@1', nullable: true },
      })
      .build();

    const items: CustomerCatalogSearchHitBase[] = [];
    for await (const row of db.runtime().query(pagePlan)) {
      const storefront = this.toStorefront(row);
      if (row.hit_type === 'STOREFRONT') {
        items.push({ type: 'STOREFRONT', storefront });
        continue;
      }
      items.push({
        type: 'PRODUCT',
        storefront,
        product: {
          productId: String(row.product_id),
          branchId: String(row.branch_id),
          categoryId: String(row.category_id),
          name: String(row.product_name),
          description:
            row.product_description === null ||
            row.product_description === undefined
              ? null
              : String(row.product_description),
          priceMinor: moneyMinorToDecimalString(row.price_minor),
        },
      });
    }
    return { items, total, limit: input.limit, offset: input.offset };
  }

  private async loadOptionGroups(
    productId: string,
  ): Promise<CustomerProductOptionGroup[]> {
    const groups = await orm(this.db())
      .ProductOptionGroup.where({ productId })
      .orderBy((group) => group.createdAt.asc())
      .all();
    if (groups.length === 0) {
      return [];
    }
    const groupIds = groups.map((group) => group.id);
    const options = await orm(this.db())
      .ProductOption.where((option) => option.optionGroupId.in(groupIds))
      .orderBy((option) => option.createdAt.asc())
      .all();

    return groups.map((group) => ({
      optionGroupId: group.id,
      name: group.name,
      required: group.required,
      minSelections: group.minSelections,
      maxSelections: group.maxSelections,
      options: options
        .filter((option) => option.optionGroupId === group.id)
        .map((option) => ({
          optionId: option.id,
          name: option.name,
          additionalPriceMinor: moneyMinorToDecimalString(
            option.additionalPriceMinor,
          ),
          available: option.available,
        })),
    }));
  }

  private toStorefront(row: {
    branch_id: string;
    branch_name: string;
    address_text: string;
    latitude: unknown;
    longitude: unknown;
    merchant_id: string;
    merchant_name: string;
    public_reference: string;
  }): CustomerStorefrontBase {
    return {
      branchId: String(row.branch_id),
      branchName: String(row.branch_name),
      addressText: String(row.address_text),
      latitude: this.parseCoordinate(row.latitude),
      longitude: this.parseCoordinate(row.longitude),
      merchantId: String(row.merchant_id),
      merchantName: String(row.merchant_name),
      merchantPublicReference: String(row.public_reference),
    };
  }

  private toProduct(row: {
    product_id: string;
    branch_id: string;
    category_id: string;
    name: string;
    description: string | null;
    price_minor: bigint | number | string;
  }): CustomerProductSummary {
    return {
      productId: String(row.product_id),
      branchId: String(row.branch_id),
      categoryId: String(row.category_id),
      name: String(row.name),
      description:
        row.description === null || row.description === undefined
          ? null
          : String(row.description),
      priceMinor: moneyMinorToDecimalString(row.price_minor),
    };
  }

  private parseCoordinate(value: unknown): number {
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      return Number(value);
    }
    return Number.NaN;
  }
}
