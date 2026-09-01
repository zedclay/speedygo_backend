import { Injectable } from '@nestjs/common';
import { customerProfileNotFound } from '../../customers/domain/customer.errors';
import {
  cartBranchMismatch,
  cartInvalidQuantity,
  cartItemNotFound,
  cartProductNotAvailable,
} from '../domain/cart.errors';
import {
  CART_QUANTITY_MAX,
  evaluatePersistedSelections,
  isCartProductOfferable,
  multiplyMinorUnits,
  normalizeOptionIds,
  optionSetsEqual,
  requireCartQuantity,
  validateCartOptionSelections,
} from '../domain/cart.policy';
import type {
  AddCartItemInput,
  CartBootstrapView,
  CartItemRecord,
  CartItemView,
  CartProductSnapshot,
  CartRecord,
  CartView,
  CartWarningCode,
  UpdateCartItemInput,
} from '../domain/cart.types';
import { CartRepository } from '../infrastructure/cart.repository';

@Injectable()
export class CartService {
  constructor(private readonly carts: CartRepository) {}

  async getCart(accountId: string): Promise<CartBootstrapView> {
    const profile = await this.requireProfile(accountId);
    const cart = await this.carts.findActiveCart(profile.id);
    if (!cart) {
      return { cartExists: false, cart: null };
    }
    return { cartExists: true, cart: await this.toCartView(cart) };
  }

  async addItem(accountId: string, input: AddCartItemInput): Promise<CartView> {
    requireCartQuantity(input.quantity);
    const profile = await this.requireProfile(accountId);
    return this.carts.runInTransaction(async (tx) => {
      const lockedProfile = await this.carts.lockCustomerProfile(
        profile.id,
        tx,
      );
      if (!lockedProfile) {
        throw customerProfileNotFound();
      }
      const productLocked = await this.carts.lockProduct(input.productId, tx);
      if (!productLocked) {
        throw cartProductNotAvailable('Product was not found', 404);
      }
      const snapshot = await this.carts.loadProductSnapshot(
        input.productId,
        tx,
      );
      if (!snapshot) {
        throw cartProductNotAvailable('Product was not found', 404);
      }
      this.requireOfferable(snapshot);
      const { additionalPriceMinor } = validateCartOptionSelections({
        groups: snapshot.groups,
        options: snapshot.options,
        selectedOptionIds: input.optionIds,
      });
      if (
        !Number.isInteger(snapshot.livePriceMinor) ||
        snapshot.livePriceMinor < 0
      ) {
        throw cartProductNotAvailable();
      }
      const selectedIds = normalizeOptionIds(input.optionIds);
      const unitPriceMinor = snapshot.livePriceMinor + additionalPriceMinor;
      const cart = await this.carts.getOrCreateActiveCart(
        profile.id,
        snapshot.merchantBranchId,
        tx,
      );
      const lockedCart = await this.carts.lockCart(cart.id, tx);
      if (!lockedCart) {
        throw cartProductNotAvailable();
      }
      if (lockedCart.merchantBranchId !== snapshot.merchantBranchId) {
        throw cartBranchMismatch();
      }
      const items = await this.carts.listItems(lockedCart.id, tx);
      const existing = items.find(
        (item) =>
          item.productId === input.productId &&
          optionSetsEqual(item.optionIds, selectedIds),
      );
      if (existing) {
        const nextQuantity = existing.quantity + input.quantity;
        if (nextQuantity > CART_QUANTITY_MAX) {
          throw cartInvalidQuantity(
            `Quantity cannot exceed ${CART_QUANTITY_MAX}`,
          );
        }
        await this.carts.updateItemQuantity(
          existing.id,
          nextQuantity,
          unitPriceMinor,
          tx,
        );
      } else {
        const created = await this.carts.createItem(
          lockedCart.id,
          {
            productId: snapshot.productId,
            quantity: input.quantity,
            unitPriceMinor,
          },
          tx,
        );
        await this.carts.replaceItemOptions(created.id, selectedIds, tx);
      }
      const latest = await this.carts.findActiveCart(profile.id, tx);
      if (!latest) {
        throw cartProductNotAvailable();
      }
      return this.toCartView(latest, tx);
    });
  }

  async updateItem(
    accountId: string,
    cartItemId: string,
    input: UpdateCartItemInput,
  ): Promise<CartView> {
    requireCartQuantity(input.quantity);
    const profile = await this.requireProfile(accountId);
    return this.carts.runInTransaction(async (tx) => {
      const cart = await this.requireOwnedActiveCart(profile.id, tx);
      await this.carts.lockCart(cart.id, tx);
      const item = await this.carts.findItem(cartItemId, tx);
      if (!item || item.cartId !== cart.id) {
        throw cartItemNotFound();
      }
      const snapshot = await this.carts.loadProductSnapshot(item.productId, tx);
      if (input.optionIds !== undefined) {
        if (!snapshot) {
          throw cartProductNotAvailable();
        }
        this.requireOfferable(snapshot);
        const { additionalPriceMinor } = validateCartOptionSelections({
          groups: snapshot.groups,
          options: snapshot.options,
          selectedOptionIds: input.optionIds,
        });
        const selectedIds = normalizeOptionIds(input.optionIds);
        if (!optionSetsEqual(selectedIds, item.optionIds)) {
          await this.carts.replaceItemOptions(item.id, selectedIds, tx);
        }
        await this.carts.updateItemQuantity(
          item.id,
          input.quantity,
          snapshot.livePriceMinor + additionalPriceMinor,
          tx,
        );
      } else {
        const unitPriceMinor = this.lastValidatedUnitPrice(item, snapshot);
        await this.carts.updateItemQuantity(
          item.id,
          input.quantity,
          unitPriceMinor,
          tx,
        );
      }
      return this.toCartView(cart, tx);
    });
  }

  async removeItem(
    accountId: string,
    cartItemId: string,
  ): Promise<CartBootstrapView> {
    const profile = await this.requireProfile(accountId);
    return this.carts.runInTransaction(async (tx) => {
      const cart = await this.requireOwnedActiveCart(profile.id, tx);
      await this.carts.lockCart(cart.id, tx);
      const item = await this.carts.findItem(cartItemId, tx);
      if (!item || item.cartId !== cart.id) {
        throw cartItemNotFound();
      }
      await this.carts.deleteItem(item.id, tx);
      const remaining = await this.carts.listItems(cart.id, tx);
      if (remaining.length === 0) {
        await this.carts.deleteCart(cart.id, tx);
        return { cartExists: false, cart: null };
      }
      return { cartExists: true, cart: await this.toCartView(cart, tx) };
    });
  }

  async clearCart(accountId: string): Promise<CartBootstrapView> {
    const profile = await this.requireProfile(accountId);
    return this.carts.runInTransaction(async (tx) => {
      const cart = await this.carts.findActiveCart(profile.id, tx);
      if (!cart) {
        return { cartExists: false, cart: null };
      }
      await this.carts.lockCart(cart.id, tx);
      await this.carts.deleteCart(cart.id, tx);
      return { cartExists: false, cart: null };
    });
  }

  private async requireProfile(accountId: string) {
    const profile = await this.carts.findProfileByAccountId(accountId);
    if (!profile) {
      throw customerProfileNotFound();
    }
    return profile;
  }

  private async requireOwnedActiveCart(
    customerId: string,
    tx: Parameters<CartRepository['lockCart']>[1],
  ): Promise<CartRecord> {
    const cart = await this.carts.findActiveCart(customerId, tx);
    if (!cart) {
      throw cartItemNotFound();
    }
    return cart;
  }

  private requireOfferable(snapshot: CartProductSnapshot): void {
    if (
      !isCartProductOfferable({
        merchantOperationalReady: snapshot.merchantOperationalReady,
        branchOperationalStatus: snapshot.branchOperationalStatus,
        categoryActive: snapshot.categoryActive,
        productAvailable: snapshot.productAvailable,
      })
    ) {
      throw cartProductNotAvailable();
    }
  }

  private lastValidatedUnitPrice(
    item: CartItemRecord,
    snapshot: CartProductSnapshot | null,
  ): number {
    if (
      !snapshot ||
      !Number.isInteger(snapshot.livePriceMinor) ||
      snapshot.livePriceMinor < 0
    ) {
      return item.unitPriceMinor;
    }
    const evaluated = evaluatePersistedSelections({
      groups: snapshot.groups,
      options: snapshot.options,
      selectedOptionIds: item.optionIds,
    });
    return snapshot.livePriceMinor + evaluated.additionalPriceMinor;
  }

  private async toCartView(
    cart: CartRecord,
    client?: Parameters<CartRepository['listItems']>[1],
  ): Promise<CartView> {
    const items = await this.carts.listItems(cart.id, client);
    const snapshots = await Promise.all(
      items.map((item) =>
        this.carts.loadProductSnapshot(item.productId, client),
      ),
    );
    const itemViews: CartItemView[] = items.map((item, index) =>
      this.toItemView(item, snapshots[index] ?? null),
    );
    const warnings = [...new Set(itemViews.flatMap((item) => item.warnings))];
    const cartSubtotalMinor = itemViews.reduce(
      (sum, item) => sum + item.lineSubtotalMinor,
      0,
    );
    const merchantId = snapshots.find((row) => row)?.merchantId ?? '';
    return {
      id: cart.id,
      status: cart.status,
      branchId: cart.merchantBranchId,
      merchantId,
      itemCount: itemViews.length,
      cartSubtotalMinor,
      cartReady:
        itemViews.length > 0 &&
        itemViews.every((item) => item.warnings.length === 0),
      warnings,
      items: itemViews,
      createdAt: cart.createdAt,
      updatedAt: cart.updatedAt,
    };
  }

  private toItemView(
    item: CartItemRecord,
    snapshot: CartProductSnapshot | null,
  ): CartItemView {
    const warnings: CartWarningCode[] = [];
    const liveBase =
      snapshot && Number.isInteger(snapshot.livePriceMinor)
        ? snapshot.livePriceMinor
        : 0;
    const offerable =
      snapshot !== null &&
      isCartProductOfferable({
        merchantOperationalReady: snapshot.merchantOperationalReady,
        branchOperationalStatus: snapshot.branchOperationalStatus,
        categoryActive: snapshot.categoryActive,
        productAvailable: snapshot.productAvailable,
      });
    if (!offerable) {
      warnings.push('CART_PRODUCT_NOT_AVAILABLE');
    }
    let optionUnitAdditionalMinor = 0;
    let selectedOptions: CartItemView['selectedOptions'] = [];
    if (snapshot) {
      const evaluated = evaluatePersistedSelections({
        groups: snapshot.groups,
        options: snapshot.options,
        selectedOptionIds: item.optionIds,
      });
      optionUnitAdditionalMinor = evaluated.additionalPriceMinor;
      selectedOptions = evaluated.selected;
      warnings.push(...evaluated.warnings);
    } else if (item.optionIds.length > 0) {
      selectedOptions = item.optionIds.map((optionId) => ({
        optionId,
        name: null,
        additionalPriceMinor: 0,
        available: false,
      }));
      warnings.push('CART_OPTION_NOT_AVAILABLE');
    }
    const unitPriceMinor = liveBase + optionUnitAdditionalMinor;
    return {
      id: item.id,
      productId: item.productId,
      productName: snapshot?.name ?? 'Unknown product',
      quantity: item.quantity,
      baseUnitPriceMinor: liveBase,
      optionUnitAdditionalMinor,
      unitPriceMinor,
      lineSubtotalMinor: multiplyMinorUnits(unitPriceMinor, item.quantity),
      storedUnitPriceMinor: item.unitPriceMinor,
      itemAvailable: offerable,
      selectedOptions,
      warnings: [...new Set(warnings)],
    };
  }
}
