import { Injectable } from '@nestjs/common';
import {
  isPostgresForeignKeyViolation,
  isPostgresUniqueViolation,
} from '../../../common/errors/postgres-unique';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import { pgBigInt, pgNow } from '../../../infrastructure/database/pg-values';
import { parseMinorUnits } from '../../catalog/domain/catalog.policy';
import { deriveMerchantReadiness } from '../../merchants/domain/merchant.policy';
import {
  cartOptionNotAvailable,
  cartProductNotAvailable,
} from '../domain/cart.errors';
import { CART_STATUS_ACTIVE } from '../domain/cart.policy';
import type {
  CartItemRecord,
  CartProductSnapshot,
  CartRecord,
  CartStatus,
} from '../domain/cart.types';

type OrmClient = { orm: SpeedyGoDb['orm'] };

function orm(client: OrmClient) {
  return client.orm.public;
}

@Injectable()
export class CartRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  runInTransaction<T>(fn: (tx: OrmClient) => Promise<T>): Promise<T> {
    return this.db().transaction((tx) => fn(tx));
  }

  async findProfileByAccountId(
    accountId: string,
    client: OrmClient = this.db(),
  ): Promise<{ id: string; accountId: string } | null> {
    const row = await orm(client).CustomerProfile.where({ accountId }).first();
    return row ? { id: row.id, accountId: row.accountId } : null;
  }

  async lockCustomerProfile(
    customerId: string,
    client: OrmClient,
  ): Promise<boolean> {
    await orm(client)
      .CustomerProfile.where({ id: customerId })
      .update({ updatedAt: pgNow() });
    const locked = await orm(client)
      .CustomerProfile.where({ id: customerId })
      .first();
    return Boolean(locked);
  }

  async findActiveCart(
    customerId: string,
    client: OrmClient = this.db(),
  ): Promise<CartRecord | null> {
    const row = await orm(client)
      .Cart.where({ customerId, status: CART_STATUS_ACTIVE })
      .first();
    return row ? this.toCart(row) : null;
  }

  async lockCart(
    cartId: string,
    client: OrmClient,
  ): Promise<CartRecord | null> {
    await orm(client).Cart.where({ id: cartId }).update({ updatedAt: pgNow() });
    const row = await orm(client).Cart.where({ id: cartId }).first();
    return row ? this.toCart(row) : null;
  }

  async createActiveCart(
    customerId: string,
    merchantBranchId: string,
    client: OrmClient,
  ): Promise<CartRecord> {
    const now = pgNow();
    const row = await orm(client).Cart.create({
      id: createUuidV7(),
      customerId,
      merchantBranchId,
      status: CART_STATUS_ACTIVE,
      createdAt: now,
      updatedAt: now,
    });
    return this.toCart(row);
  }

  async getOrCreateActiveCart(
    customerId: string,
    merchantBranchId: string,
    client: OrmClient,
  ): Promise<CartRecord> {
    const existing = await this.findActiveCart(customerId, client);
    if (existing) {
      return existing;
    }
    try {
      return await this.createActiveCart(customerId, merchantBranchId, client);
    } catch (error) {
      if (!isPostgresUniqueViolation(error)) {
        throw error;
      }
      const raced = await this.findActiveCart(customerId, client);
      if (!raced) {
        throw error;
      }
      return raced;
    }
  }

  async listItems(
    cartId: string,
    client: OrmClient = this.db(),
  ): Promise<CartItemRecord[]> {
    const rows = await orm(client)
      .CartItem.where({ cartId })
      .orderBy((item) => item.createdAt.asc())
      .all();
    const optionIds = await this.optionIdsByItemIds(
      rows.map((row) => row.id),
      client,
    );
    return rows.map((row) => this.toItem(row, optionIds.get(row.id) ?? []));
  }

  async findItem(
    cartItemId: string,
    client: OrmClient = this.db(),
  ): Promise<CartItemRecord | null> {
    const row = await orm(client).CartItem.where({ id: cartItemId }).first();
    if (!row) {
      return null;
    }
    const optionIds = await this.optionIdsByItemIds([row.id], client);
    return this.toItem(row, optionIds.get(row.id) ?? []);
  }

  async replaceItemOptions(
    cartItemId: string,
    optionIds: string[],
    client: OrmClient,
  ): Promise<void> {
    const existing = await orm(client)
      .CartItemOption.where({ cartItemId })
      .all();
    for (const row of existing) {
      await orm(client).CartItemOption.where({ id: row.id }).delete();
    }
    const now = pgNow();
    for (const productOptionId of optionIds) {
      try {
        await orm(client).CartItemOption.create({
          id: createUuidV7(),
          cartItemId,
          productOptionId,
          createdAt: now,
        });
      } catch (error) {
        if (isPostgresForeignKeyViolation(error)) {
          throw cartOptionNotAvailable();
        }
        if (isPostgresUniqueViolation(error)) {
          throw cartOptionNotAvailable();
        }
        throw error;
      }
    }
  }

  async createItem(
    cartId: string,
    input: { productId: string; quantity: number; unitPriceMinor: number },
    client: OrmClient,
  ): Promise<CartItemRecord> {
    const now = pgNow();
    try {
      const row = await orm(client).CartItem.create({
        id: createUuidV7(),
        cartId,
        productId: input.productId,
        quantity: input.quantity,
        unitPriceMinor: pgBigInt(input.unitPriceMinor),
        createdAt: now,
        updatedAt: now,
      });
      return this.toItem(row, []);
    } catch (error) {
      if (isPostgresForeignKeyViolation(error)) {
        throw cartProductNotAvailable(
          'Product is not available for this Cart',
          409,
        );
      }
      throw error;
    }
  }

  async updateItemQuantity(
    cartItemId: string,
    quantity: number,
    unitPriceMinor: number,
    client: OrmClient,
  ): Promise<CartItemRecord | null> {
    await orm(client)
      .CartItem.where({ id: cartItemId })
      .update({
        quantity,
        unitPriceMinor: pgBigInt(unitPriceMinor),
        updatedAt: pgNow(),
      });
    return this.findItem(cartItemId, client);
  }

  async deleteItem(cartItemId: string, client: OrmClient): Promise<boolean> {
    const existing = await this.findItem(cartItemId, client);
    if (!existing) {
      return false;
    }
    await orm(client).CartItem.where({ id: cartItemId }).delete();
    return true;
  }

  async deleteCart(cartId: string, client: OrmClient): Promise<boolean> {
    const existing = await orm(client).Cart.where({ id: cartId }).first();
    if (!existing) {
      return false;
    }
    await orm(client).Cart.where({ id: cartId }).delete();
    return true;
  }

  async lockProduct(productId: string, client: OrmClient): Promise<boolean> {
    await orm(client)
      .Product.where({ id: productId })
      .update({ updatedAt: pgNow() });
    const row = await orm(client).Product.where({ id: productId }).first();
    return Boolean(row);
  }

  async loadProductSnapshot(
    productId: string,
    client: OrmClient = this.db(),
  ): Promise<CartProductSnapshot | null> {
    const product = await orm(client).Product.where({ id: productId }).first();
    if (!product) {
      return null;
    }
    const [category, branch, groups] = await Promise.all([
      orm(client).Category.where({ id: product.categoryId }).first(),
      orm(client)
        .MerchantBranch.where({ id: product.merchantBranchId })
        .first(),
      orm(client).ProductOptionGroup.where({ productId: product.id }).all(),
    ]);
    if (!category || !branch) {
      return null;
    }
    const merchant = await orm(client)
      .Merchant.where({ id: branch.merchantId })
      .first();
    if (!merchant) {
      return null;
    }
    const groupIds = groups.map((group) => group.id);
    const options =
      groupIds.length === 0
        ? []
        : await orm(client)
            .ProductOption.where((option) => option.optionGroupId.in(groupIds))
            .all();
    const branchRows = await orm(client)
      .MerchantBranch.where({ merchantId: merchant.id })
      .select('operationalStatus')
      .all();
    const readiness = deriveMerchantReadiness({
      name: merchant.name,
      status: merchant.status,
      verifiedAt: merchant.verifiedAt,
      branchOperationalStatuses: branchRows.map((row) => row.operationalStatus),
    });
    return {
      productId: product.id,
      name: product.name,
      merchantId: merchant.id,
      merchantBranchId: product.merchantBranchId,
      categoryId: product.categoryId,
      categoryActive: category.active,
      productAvailable: product.available,
      livePriceMinor: parseMinorUnits(product.priceMinor),
      merchantStatus: merchant.status,
      merchantVerifiedAt: merchant.verifiedAt,
      merchantName: merchant.name,
      branchOperationalStatus: branch.operationalStatus,
      merchantOperationalReady: readiness.operationalReady,
      groups: groups.map((group) => ({
        id: group.id,
        required: group.required,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
      })),
      options: options.map((option) => ({
        id: option.id,
        optionGroupId: option.optionGroupId,
        name: option.name,
        available: option.available,
        additionalPriceMinor: parseMinorUnits(option.additionalPriceMinor),
      })),
    };
  }

  private toCart(row: {
    id: string;
    customerId: string;
    merchantBranchId: string;
    status: CartStatus;
    createdAt: string;
    updatedAt: string;
  }): CartRecord {
    return {
      id: row.id,
      customerId: row.customerId,
      merchantBranchId: row.merchantBranchId,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async optionIdsByItemIds(
    itemIds: string[],
    client: OrmClient,
  ): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (itemIds.length === 0) {
      return map;
    }
    const rows = await orm(client)
      .CartItemOption.where((option) => option.cartItemId.in(itemIds))
      .all();
    for (const row of rows) {
      const list = map.get(row.cartItemId) ?? [];
      list.push(row.productOptionId);
      map.set(row.cartItemId, list);
    }
    return map;
  }

  private toItem(
    row: {
      id: string;
      cartId: string;
      productId: string;
      quantity: number;
      unitPriceMinor: unknown;
      createdAt: string;
      updatedAt: string;
    },
    optionIds: string[],
  ): CartItemRecord {
    return {
      id: row.id,
      cartId: row.cartId,
      productId: row.productId,
      quantity: row.quantity,
      unitPriceMinor: parseMinorUnits(row.unitPriceMinor),
      optionIds,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
