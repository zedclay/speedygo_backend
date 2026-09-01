import { Injectable } from '@nestjs/common';
import {
  isPostgresCheckViolation,
  isPostgresForeignKeyViolation,
} from '../../../common/errors/postgres-unique';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import {
  pgBigInt,
  pgNow,
  pgVarchar,
} from '../../../infrastructure/database/pg-values';
import {
  catalogCategoryInUse,
  catalogCategoryNotFound,
  catalogInvalidPrice,
  catalogOptionGroupInvalid,
  catalogProductInUse,
} from '../domain/catalog.errors';
import { escapeLikeContains, parseMinorUnits } from '../domain/catalog.policy';
import type {
  CatalogStats,
  CategoryRecord,
  CreateCategoryInput,
  CreateOptionGroupInput,
  CreateOptionInput,
  CreateProductInput,
  OptionGroupRecord,
  OptionRecord,
  ProductListQuery,
  ProductRecord,
  UpdateCategoryInput,
  UpdateOptionGroupInput,
  UpdateOptionInput,
  UpdateProductInput,
} from '../domain/catalog.types';

function orm(client: { orm: SpeedyGoDb['orm'] }) {
  return client.orm.public;
}

@Injectable()
export class CatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async listCategories(branchId: string): Promise<CategoryRecord[]> {
    const rows = await orm(this.db())
      .Category.where({ merchantBranchId: branchId })
      .orderBy((category) => category.sortOrder.asc())
      .all();
    return rows
      .map((row) => this.toCategory(row))
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) {
          return a.sortOrder - b.sortOrder;
        }
        return a.createdAt.localeCompare(b.createdAt);
      });
  }

  async findCategory(id: string): Promise<CategoryRecord | null> {
    const row = await orm(this.db()).Category.where({ id }).first();
    return row ? this.toCategory(row) : null;
  }

  async createCategory(
    branchId: string,
    input: CreateCategoryInput,
  ): Promise<CategoryRecord> {
    const now = pgNow();
    const row = await orm(this.db()).Category.create({
      id: createUuidV7(),
      merchantBranchId: branchId,
      name: pgVarchar<255>(input.name),
      sortOrder: input.sortOrder ?? 0,
      active: input.active ?? true,
      createdAt: now,
      updatedAt: now,
    });
    return this.toCategory(row);
  }

  async updateCategory(
    categoryId: string,
    input: UpdateCategoryInput,
  ): Promise<CategoryRecord | null> {
    const existing = await this.findCategory(categoryId);
    if (!existing) {
      return null;
    }
    const patch: {
      name?: ReturnType<typeof pgVarchar<255>>;
      sortOrder?: number;
      active?: boolean;
      updatedAt: ReturnType<typeof pgNow>;
    } = { updatedAt: pgNow() };
    if (input.name !== undefined) {
      patch.name = pgVarchar<255>(input.name);
    }
    if (input.sortOrder !== undefined) {
      patch.sortOrder = input.sortOrder;
    }
    if (input.active !== undefined) {
      patch.active = input.active;
    }
    await orm(this.db()).Category.where({ id: categoryId }).update(patch);
    return this.findCategory(categoryId);
  }

  async countProductsInCategory(categoryId: string): Promise<number> {
    const result = await orm(this.db())
      .Product.where({ categoryId })
      .aggregate((agg) => ({ total: agg.count() }));
    return Number(result.total);
  }

  async deleteCategory(categoryId: string): Promise<boolean> {
    const existing = await this.findCategory(categoryId);
    if (!existing) {
      return false;
    }
    try {
      await orm(this.db()).Category.where({ id: categoryId }).delete();
      return true;
    } catch (error) {
      if (isPostgresForeignKeyViolation(error)) {
        throw catalogCategoryInUse();
      }
      throw error;
    }
  }

  async listProducts(
    branchId: string,
    query: ProductListQuery,
  ): Promise<{ items: ProductRecord[]; total: number }> {
    const counted = await this.productCollection(branchId, query).aggregate(
      (agg) => ({ total: agg.count() }),
    );
    const rows = await this.productCollection(branchId, query)
      .orderBy((product) => product.createdAt.asc())
      .offset(query.offset)
      .limit(query.limit)
      .all();
    return {
      items: rows.map((row) => this.toProduct(row)),
      total: Number(counted.total),
    };
  }

  private productCollection(branchId: string, query: ProductListQuery) {
    let collection = orm(this.db()).Product.where({
      merchantBranchId: branchId,
    });
    if (query.categoryId) {
      collection = collection.where({ categoryId: query.categoryId });
    }
    if (query.available !== undefined) {
      collection = collection.where({ available: query.available });
    }
    const needle = query.q ? escapeLikeContains(query.q.trim()) : '';
    if (needle.length > 0) {
      collection = collection.where((product) =>
        product.name.like(`%${needle}%`),
      );
    }
    return collection;
  }

  async findProduct(id: string): Promise<ProductRecord | null> {
    const row = await orm(this.db()).Product.where({ id }).first();
    return row ? this.toProduct(row) : null;
  }

  async createProduct(
    branchId: string,
    input: CreateProductInput,
  ): Promise<ProductRecord> {
    const now = pgNow();
    try {
      const row = await orm(this.db()).Product.create({
        id: createUuidV7(),
        merchantBranchId: branchId,
        categoryId: input.categoryId,
        name: pgVarchar<255>(input.name),
        description: input.description ?? null,
        priceMinor: pgBigInt(input.priceMinor),
        available: input.available ?? true,
        createdAt: now,
        updatedAt: now,
      });
      return this.toProduct(row);
    } catch (error) {
      if (isPostgresCheckViolation(error)) {
        throw catalogInvalidPrice();
      }
      if (isPostgresForeignKeyViolation(error)) {
        throw catalogCategoryNotFound();
      }
      throw error;
    }
  }

  async updateProduct(
    productId: string,
    input: UpdateProductInput,
  ): Promise<ProductRecord | null> {
    const existing = await this.findProduct(productId);
    if (!existing) {
      return null;
    }
    const patch: {
      categoryId?: string;
      name?: ReturnType<typeof pgVarchar<255>>;
      description?: string | null;
      priceMinor?: bigint;
      available?: boolean;
      updatedAt: ReturnType<typeof pgNow>;
    } = { updatedAt: pgNow() };
    if (input.categoryId !== undefined) {
      patch.categoryId = input.categoryId;
    }
    if (input.name !== undefined) {
      patch.name = pgVarchar<255>(input.name);
    }
    if (input.description !== undefined) {
      patch.description = input.description;
    }
    if (input.priceMinor !== undefined) {
      patch.priceMinor = pgBigInt(input.priceMinor);
    }
    if (input.available !== undefined) {
      patch.available = input.available;
    }
    try {
      await orm(this.db()).Product.where({ id: productId }).update(patch);
    } catch (error) {
      if (isPostgresCheckViolation(error)) {
        throw catalogInvalidPrice();
      }
      if (isPostgresForeignKeyViolation(error)) {
        throw catalogCategoryInUse();
      }
      throw error;
    }
    return this.findProduct(productId);
  }

  /**
   * Locks the Product row, refuses delete when any OrderItem still
   * references it, then deletes. Do not rely on ON DELETE SET NULL.
   *
   * Future Order creation MUST take the same Product row lock in the
   * order-insert transaction (UPDATE products.updated_at, or equivalent
   * FOR UPDATE) so an OrderItem cannot appear between this check and
   * the delete. Prisma 8 has no forUpdate helper; row UPDATE is the
   * current lock pattern.
   */
  async deleteProduct(productId: string): Promise<boolean> {
    const db = this.db();
    return db.transaction(async (tx) => {
      await orm(tx)
        .Product.where({ id: productId })
        .update({ updatedAt: pgNow() });
      const locked = await orm(tx).Product.where({ id: productId }).first();
      if (!locked) {
        return false;
      }
      const historical = await orm(tx)
        .OrderItem.where({ productId })
        .select('id')
        .limit(1)
        .all();
      if (historical.length > 0) {
        throw catalogProductInUse();
      }
      try {
        await orm(tx).Product.where({ id: productId }).delete();
        return true;
      } catch (error) {
        if (isPostgresForeignKeyViolation(error)) {
          throw catalogProductInUse();
        }
        throw error;
      }
    });
  }

  async catalogStats(branchId: string): Promise<CatalogStats> {
    const db = orm(this.db());
    const [categories, products, available] = await Promise.all([
      db.Category.where({ merchantBranchId: branchId }).aggregate((agg) => ({
        total: agg.count(),
      })),
      db.Product.where({ merchantBranchId: branchId }).aggregate((agg) => ({
        total: agg.count(),
      })),
      db.Product.where({
        merchantBranchId: branchId,
        available: true,
      }).aggregate((agg) => ({ total: agg.count() })),
    ]);
    return {
      categoryCount: Number(categories.total),
      productCount: Number(products.total),
      availableProductCount: Number(available.total),
    };
  }

  async listOptionGroups(productId: string): Promise<OptionGroupRecord[]> {
    const rows = await orm(this.db())
      .ProductOptionGroup.where({ productId })
      .orderBy((group) => group.createdAt.asc())
      .all();
    return rows.map((row) => this.toGroup(row));
  }

  async findOptionGroup(id: string): Promise<OptionGroupRecord | null> {
    const row = await orm(this.db()).ProductOptionGroup.where({ id }).first();
    return row ? this.toGroup(row) : null;
  }

  async createOptionGroup(
    productId: string,
    input: CreateOptionGroupInput,
  ): Promise<OptionGroupRecord> {
    const now = pgNow();
    try {
      const row = await orm(this.db()).ProductOptionGroup.create({
        id: createUuidV7(),
        productId,
        name: pgVarchar<255>(input.name),
        required: input.required,
        minSelections: input.minSelections,
        maxSelections: input.maxSelections,
        createdAt: now,
        updatedAt: now,
      });
      return this.toGroup(row);
    } catch (error) {
      if (isPostgresCheckViolation(error)) {
        throw catalogOptionGroupInvalid();
      }
      throw error;
    }
  }

  async updateOptionGroup(
    groupId: string,
    input: UpdateOptionGroupInput,
  ): Promise<OptionGroupRecord | null> {
    const existing = await this.findOptionGroup(groupId);
    if (!existing) {
      return null;
    }
    const patch: {
      name?: ReturnType<typeof pgVarchar<255>>;
      required?: boolean;
      minSelections?: number;
      maxSelections?: number;
      updatedAt: ReturnType<typeof pgNow>;
    } = { updatedAt: pgNow() };
    if (input.name !== undefined) {
      patch.name = pgVarchar<255>(input.name);
    }
    if (input.required !== undefined) {
      patch.required = input.required;
    }
    if (input.minSelections !== undefined) {
      patch.minSelections = input.minSelections;
    }
    if (input.maxSelections !== undefined) {
      patch.maxSelections = input.maxSelections;
    }
    try {
      await orm(this.db())
        .ProductOptionGroup.where({ id: groupId })
        .update(patch);
    } catch (error) {
      if (isPostgresCheckViolation(error)) {
        throw catalogOptionGroupInvalid();
      }
      throw error;
    }
    return this.findOptionGroup(groupId);
  }

  async deleteOptionGroup(groupId: string): Promise<boolean> {
    const existing = await this.findOptionGroup(groupId);
    if (!existing) {
      return false;
    }
    await orm(this.db()).ProductOptionGroup.where({ id: groupId }).delete();
    return true;
  }

  async listOptions(optionGroupId: string): Promise<OptionRecord[]> {
    const rows = await orm(this.db())
      .ProductOption.where({ optionGroupId })
      .orderBy((option) => option.createdAt.asc())
      .all();
    return rows.map((row) => this.toOption(row));
  }

  async listOptionsByGroupIds(groupIds: string[]): Promise<OptionRecord[]> {
    if (groupIds.length === 0) {
      return [];
    }
    const rows = await orm(this.db())
      .ProductOption.where((option) => option.optionGroupId.in(groupIds))
      .orderBy((option) => option.createdAt.asc())
      .all();
    return rows.map((row) => this.toOption(row));
  }

  async findOption(id: string): Promise<OptionRecord | null> {
    const row = await orm(this.db()).ProductOption.where({ id }).first();
    return row ? this.toOption(row) : null;
  }

  async createOption(
    optionGroupId: string,
    input: CreateOptionInput,
  ): Promise<OptionRecord> {
    const now = pgNow();
    try {
      const row = await orm(this.db()).ProductOption.create({
        id: createUuidV7(),
        optionGroupId,
        name: pgVarchar<255>(input.name),
        additionalPriceMinor: pgBigInt(input.additionalPriceMinor),
        available: input.available ?? true,
        createdAt: now,
        updatedAt: now,
      });
      return this.toOption(row);
    } catch (error) {
      if (isPostgresCheckViolation(error)) {
        throw catalogInvalidPrice();
      }
      throw error;
    }
  }

  async updateOption(
    optionId: string,
    input: UpdateOptionInput,
  ): Promise<OptionRecord | null> {
    const existing = await this.findOption(optionId);
    if (!existing) {
      return null;
    }
    const patch: {
      name?: ReturnType<typeof pgVarchar<255>>;
      additionalPriceMinor?: bigint;
      available?: boolean;
      updatedAt: ReturnType<typeof pgNow>;
    } = { updatedAt: pgNow() };
    if (input.name !== undefined) {
      patch.name = pgVarchar<255>(input.name);
    }
    if (input.additionalPriceMinor !== undefined) {
      patch.additionalPriceMinor = pgBigInt(input.additionalPriceMinor);
    }
    if (input.available !== undefined) {
      patch.available = input.available;
    }
    try {
      await orm(this.db()).ProductOption.where({ id: optionId }).update(patch);
    } catch (error) {
      if (isPostgresCheckViolation(error)) {
        throw catalogInvalidPrice();
      }
      throw error;
    }
    return this.findOption(optionId);
  }

  async deleteOption(optionId: string): Promise<boolean> {
    const existing = await this.findOption(optionId);
    if (!existing) {
      return false;
    }
    await orm(this.db()).ProductOption.where({ id: optionId }).delete();
    return true;
  }

  private toCategory(row: {
    id: string;
    merchantBranchId: string;
    name: string;
    sortOrder: number;
    active: boolean;
    createdAt: string;
    updatedAt: string;
  }): CategoryRecord {
    return {
      id: row.id,
      merchantBranchId: row.merchantBranchId,
      name: row.name,
      sortOrder: row.sortOrder,
      active: row.active,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toProduct(row: {
    id: string;
    merchantBranchId: string;
    categoryId: string;
    name: string;
    description: string | null;
    priceMinor: unknown;
    available: boolean;
    createdAt: string;
    updatedAt: string;
  }): ProductRecord {
    return {
      id: row.id,
      merchantBranchId: row.merchantBranchId,
      categoryId: row.categoryId,
      name: row.name,
      description: row.description,
      priceMinor: parseMinorUnits(row.priceMinor),
      available: row.available,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toGroup(row: {
    id: string;
    productId: string;
    name: string;
    required: boolean;
    minSelections: number;
    maxSelections: number;
    createdAt: string;
    updatedAt: string;
  }): OptionGroupRecord {
    return {
      id: row.id,
      productId: row.productId,
      name: row.name,
      required: row.required,
      minSelections: row.minSelections,
      maxSelections: row.maxSelections,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toOption(row: {
    id: string;
    optionGroupId: string;
    name: string;
    additionalPriceMinor: unknown;
    available: boolean;
    createdAt: string;
    updatedAt: string;
  }): OptionRecord {
    return {
      id: row.id,
      optionGroupId: row.optionGroupId,
      name: row.name,
      additionalPriceMinor: parseMinorUnits(row.additionalPriceMinor),
      available: row.available,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
