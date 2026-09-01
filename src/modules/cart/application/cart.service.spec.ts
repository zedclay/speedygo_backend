import { CUSTOMER_ERROR_CODES } from '../../customers/domain/customer.errors';
import { CartService } from './cart.service';
import { CART_ERROR_CODES } from '../domain/cart.errors';
import { CART_STATUS_ACTIVE } from '../domain/cart.policy';
import type {
  CartItemRecord,
  CartProductSnapshot,
  CartRecord,
} from '../domain/cart.types';

const ACCOUNT_A = '11111111-1111-7111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-7222-8222-222222222222';
const ACCOUNT_NONE = '33333333-3333-7333-8333-333333333333';

function now(): string {
  return new Date().toISOString();
}

function offerableSnapshot(
  overrides: Partial<CartProductSnapshot> = {},
): CartProductSnapshot {
  return {
    productId: 'product-1',
    name: 'Coffee',
    merchantId: 'merchant-1',
    merchantBranchId: 'branch-1',
    categoryId: 'category-1',
    categoryActive: true,
    productAvailable: true,
    livePriceMinor: 1000,
    merchantStatus: 'ACTIVE',
    merchantVerifiedAt: now(),
    merchantName: 'Cafe',
    branchOperationalStatus: 'ACTIVE',
    merchantOperationalReady: true,
    groups: [],
    options: [],
    ...overrides,
  };
}

function configurableSnapshot(
  overrides: Partial<CartProductSnapshot> = {},
): CartProductSnapshot {
  return offerableSnapshot({
    productId: 'product-opt',
    groups: [
      { id: 'g1', required: true, minSelections: 1, maxSelections: 1 },
      { id: 'g2', required: false, minSelections: 0, maxSelections: 2 },
    ],
    options: [
      {
        id: 'o-large',
        optionGroupId: 'g1',
        name: 'Large',
        available: true,
        additionalPriceMinor: 200,
      },
      {
        id: 'o-small',
        optionGroupId: 'g1',
        name: 'Small',
        available: true,
        additionalPriceMinor: 0,
      },
      {
        id: 'o-milk',
        optionGroupId: 'g2',
        name: 'Milk',
        available: true,
        additionalPriceMinor: 50,
      },
      {
        id: 'o-unavail',
        optionGroupId: 'g1',
        name: 'Gone',
        available: false,
        additionalPriceMinor: 0,
      },
    ],
    ...overrides,
  });
}

class MemoryCartRepository {
  profiles = new Map<string, { id: string; accountId: string }>();
  carts: CartRecord[] = [];
  items: CartItemRecord[] = [];
  snapshots = new Map<string, CartProductSnapshot>();
  missingProducts = new Set<string>();
  private txTail: Promise<void> = Promise.resolve();

  findProfileByAccountId(accountId: string) {
    return Promise.resolve(this.profiles.get(accountId) ?? null);
  }

  lockCustomerProfile(customerId: string) {
    return Promise.resolve(
      [...this.profiles.values()].some((row) => row.id === customerId),
    );
  }

  findActiveCart(customerId: string) {
    return Promise.resolve(
      this.carts.find(
        (row) =>
          row.customerId === customerId && row.status === CART_STATUS_ACTIVE,
      ) ?? null,
    );
  }

  lockCart(cartId: string) {
    return Promise.resolve(this.carts.find((row) => row.id === cartId) ?? null);
  }

  createActiveCart(customerId: string, merchantBranchId: string) {
    const active = this.carts.find(
      (row) =>
        row.customerId === customerId && row.status === CART_STATUS_ACTIVE,
    );
    if (active) {
      const error = new Error('unique');
      (error as { code: string }).code = '23505';
      throw error;
    }
    const row: CartRecord = {
      id: `cart-${this.carts.length + 1}`,
      customerId,
      merchantBranchId,
      status: CART_STATUS_ACTIVE,
      createdAt: now(),
      updatedAt: now(),
    };
    this.carts.push(row);
    return Promise.resolve(row);
  }

  async getOrCreateActiveCart(customerId: string, merchantBranchId: string) {
    const existing = await this.findActiveCart(customerId);
    if (existing) {
      return existing;
    }
    return this.createActiveCart(customerId, merchantBranchId);
  }

  listItems(cartId: string) {
    return Promise.resolve(this.items.filter((row) => row.cartId === cartId));
  }

  findItem(cartItemId: string) {
    return Promise.resolve(
      this.items.find((row) => row.id === cartItemId) ?? null,
    );
  }

  createItem(
    cartId: string,
    input: { productId: string; quantity: number; unitPriceMinor: number },
  ) {
    const row: CartItemRecord = {
      id: `item-${this.items.length + 1}`,
      cartId,
      productId: input.productId,
      quantity: input.quantity,
      unitPriceMinor: input.unitPriceMinor,
      optionIds: [],
      createdAt: now(),
      updatedAt: now(),
    };
    this.items.push(row);
    return Promise.resolve(row);
  }

  replaceItemOptions(cartItemId: string, optionIds: string[]) {
    const row = this.items.find((item) => item.id === cartItemId);
    if (row) {
      row.optionIds = [...optionIds];
      row.updatedAt = now();
    }
    return Promise.resolve();
  }

  updateItemQuantity(
    cartItemId: string,
    quantity: number,
    unitPriceMinor: number,
  ) {
    const row = this.items.find((item) => item.id === cartItemId);
    if (!row) {
      return Promise.resolve(null);
    }
    row.quantity = quantity;
    row.unitPriceMinor = unitPriceMinor;
    row.updatedAt = now();
    return Promise.resolve(row);
  }

  deleteItem(cartItemId: string) {
    const before = this.items.length;
    this.items = this.items.filter((row) => row.id !== cartItemId);
    return Promise.resolve(this.items.length !== before);
  }

  deleteCart(cartId: string) {
    const before = this.carts.length;
    this.items = this.items.filter((row) => row.cartId !== cartId);
    this.carts = this.carts.filter((row) => row.id !== cartId);
    return Promise.resolve(this.carts.length !== before);
  }

  lockProduct(productId: string) {
    if (this.missingProducts.has(productId)) {
      return Promise.resolve(false);
    }
    return Promise.resolve(this.snapshots.has(productId));
  }

  loadProductSnapshot(productId: string) {
    return Promise.resolve(this.snapshots.get(productId) ?? null);
  }

  runInTransaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
    const run = this.txTail.then(() => fn(undefined as never));
    this.txTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

describe('Cart foundation services', () => {
  let repo: MemoryCartRepository;
  let service: CartService;

  beforeEach(() => {
    repo = new MemoryCartRepository();
    repo.profiles.set(ACCOUNT_A, { id: 'customer-a', accountId: ACCOUNT_A });
    repo.profiles.set(ACCOUNT_B, { id: 'customer-b', accountId: ACCOUNT_B });
    service = new CartService(repo as never);
  });

  it('requires a CustomerProfile and does not auto-create one', async () => {
    await expect(service.getCart(ACCOUNT_NONE)).rejects.toMatchObject({
      code: CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND,
    });
    await expect(
      service.addItem(ACCOUNT_NONE, {
        productId: 'product-1',
        quantity: 1,
        optionIds: [],
      }),
    ).rejects.toMatchObject({
      code: CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND,
    });
  });

  it('returns no Cart without creating one on GET', async () => {
    const result = await service.getCart(ACCOUNT_A);
    expect(result).toEqual({ cartExists: false, cart: null });
    expect(repo.carts).toHaveLength(0);
  });

  it('creates an Active Cart lazily on first valid add and computes totals', async () => {
    repo.snapshots.set('product-1', offerableSnapshot());
    const cart = await service.addItem(ACCOUNT_A, {
      productId: 'product-1',
      quantity: 2,
      optionIds: [],
    });
    expect(cart.status).toBe(CART_STATUS_ACTIVE);
    expect(cart.branchId).toBe('branch-1');
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]?.baseUnitPriceMinor).toBe(1000);
    expect(cart.items[0]?.lineSubtotalMinor).toBe(2000);
    expect(cart.cartSubtotalMinor).toBe(2000);
    expect(cart.cartReady).toBe(true);
    expect(repo.carts).toHaveLength(1);
  });

  it('increments quantity for the same Product and option set', async () => {
    repo.snapshots.set('product-1', offerableSnapshot());
    await service.addItem(ACCOUNT_A, {
      productId: 'product-1',
      quantity: 1,
      optionIds: [],
    });
    const cart = await service.addItem(ACCOUNT_A, {
      productId: 'product-1',
      quantity: 2,
      optionIds: [],
    });
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]?.quantity).toBe(3);
    expect(cart.cartSubtotalMinor).toBe(3000);
  });

  it('rejects a Product from another Branch on an existing Active Cart', async () => {
    repo.snapshots.set('product-1', offerableSnapshot());
    repo.snapshots.set(
      'product-2',
      offerableSnapshot({
        productId: 'product-2',
        merchantBranchId: 'branch-2',
        merchantId: 'merchant-2',
      }),
    );
    await service.addItem(ACCOUNT_A, {
      productId: 'product-1',
      quantity: 1,
      optionIds: [],
    });
    await expect(
      service.addItem(ACCOUNT_A, {
        productId: 'product-2',
        quantity: 1,
        optionIds: [],
      }),
    ).rejects.toMatchObject({
      code: CART_ERROR_CODES.CART_BRANCH_MISMATCH,
    });
    expect(repo.carts).toHaveLength(1);
    expect(repo.items).toHaveLength(1);
  });

  it('rejects missing, unavailable, inactive-category, and non-operational Products', async () => {
    await expect(
      service.addItem(ACCOUNT_A, {
        productId: 'missing',
        quantity: 1,
        optionIds: [],
      }),
    ).rejects.toMatchObject({
      code: CART_ERROR_CODES.CART_PRODUCT_NOT_AVAILABLE,
    });
    repo.snapshots.set(
      'unavailable',
      offerableSnapshot({ productId: 'unavailable', productAvailable: false }),
    );
    await expect(
      service.addItem(ACCOUNT_A, {
        productId: 'unavailable',
        quantity: 1,
        optionIds: [],
      }),
    ).rejects.toMatchObject({
      code: CART_ERROR_CODES.CART_PRODUCT_NOT_AVAILABLE,
    });
    repo.snapshots.set(
      'inactive-cat',
      offerableSnapshot({ productId: 'inactive-cat', categoryActive: false }),
    );
    await expect(
      service.addItem(ACCOUNT_A, {
        productId: 'inactive-cat',
        quantity: 1,
        optionIds: [],
      }),
    ).rejects.toMatchObject({
      code: CART_ERROR_CODES.CART_PRODUCT_NOT_AVAILABLE,
    });
    repo.snapshots.set(
      'suspended',
      offerableSnapshot({
        productId: 'suspended',
        merchantOperationalReady: false,
        merchantStatus: 'SUSPENDED',
      }),
    );
    await expect(
      service.addItem(ACCOUNT_A, {
        productId: 'suspended',
        quantity: 1,
        optionIds: [],
      }),
    ).rejects.toMatchObject({
      code: CART_ERROR_CODES.CART_PRODUCT_NOT_AVAILABLE,
    });
    repo.snapshots.set(
      'inactive-branch',
      offerableSnapshot({
        productId: 'inactive-branch',
        branchOperationalStatus: 'INACTIVE',
        merchantOperationalReady: false,
      }),
    );
    await expect(
      service.addItem(ACCOUNT_A, {
        productId: 'inactive-branch',
        quantity: 1,
        optionIds: [],
      }),
    ).rejects.toMatchObject({
      code: CART_ERROR_CODES.CART_PRODUCT_NOT_AVAILABLE,
    });
  });

  it('persists required options, includes option prices, and can become cartReady', async () => {
    repo.snapshots.set('product-opt', configurableSnapshot());
    await expect(
      service.addItem(ACCOUNT_A, {
        productId: 'product-opt',
        quantity: 1,
        optionIds: [],
      }),
    ).rejects.toMatchObject({
      code: CART_ERROR_CODES.CART_REQUIRED_OPTION_MISSING,
    });
    await expect(
      service.addItem(ACCOUNT_A, {
        productId: 'product-opt',
        quantity: 1,
        optionIds: ['foreign'],
      }),
    ).rejects.toMatchObject({
      code: CART_ERROR_CODES.CART_OPTION_INVALID,
    });
    await expect(
      service.addItem(ACCOUNT_A, {
        productId: 'product-opt',
        quantity: 1,
        optionIds: ['o-unavail'],
      }),
    ).rejects.toMatchObject({
      code: CART_ERROR_CODES.CART_OPTION_NOT_AVAILABLE,
    });
    const cart = await service.addItem(ACCOUNT_A, {
      productId: 'product-opt',
      quantity: 1,
      optionIds: ['o-large'],
    });
    expect(cart.cartReady).toBe(true);
    expect(cart.items[0]?.storedUnitPriceMinor).toBe(1200);
    expect(cart.items[0]?.optionUnitAdditionalMinor).toBe(200);
    expect(cart.items[0]?.unitPriceMinor).toBe(1200);
    expect(cart.items[0]?.lineSubtotalMinor).toBe(1200);
    expect(cart.items[0]?.selectedOptions).toEqual([
      {
        optionId: 'o-large',
        name: 'Large',
        additionalPriceMinor: 200,
        available: true,
      },
    ]);
    const got = await service.getCart(ACCOUNT_A);
    expect(got.cart?.items[0]?.selectedOptions[0]?.optionId).toBe('o-large');
  });

  it('merges identical option sets regardless of order and splits different sets', async () => {
    repo.snapshots.set('product-opt', configurableSnapshot());
    await service.addItem(ACCOUNT_A, {
      productId: 'product-opt',
      quantity: 1,
      optionIds: ['o-large', 'o-milk'],
    });
    const merged = await service.addItem(ACCOUNT_A, {
      productId: 'product-opt',
      quantity: 1,
      optionIds: ['o-milk', 'o-large'],
    });
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0]?.quantity).toBe(2);
    expect(merged.cartSubtotalMinor).toBe(2500);
    const split = await service.addItem(ACCOUNT_A, {
      productId: 'product-opt',
      quantity: 1,
      optionIds: ['o-small'],
    });
    expect(split.items).toHaveLength(2);
  });

  it('does not create duplicate lines for concurrent identical adds', async () => {
    repo.snapshots.set('product-1', offerableSnapshot());
    const [first, second] = await Promise.all([
      service.addItem(ACCOUNT_A, {
        productId: 'product-1',
        quantity: 1,
        optionIds: [],
      }),
      service.addItem(ACCOUNT_A, {
        productId: 'product-1',
        quantity: 1,
        optionIds: [],
      }),
    ]);
    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.quantity).toBe(2);
    expect(repo.items).toHaveLength(1);
  });

  it('rejects quantity above 99', async () => {
    repo.snapshots.set('product-1', offerableSnapshot());
    await service.addItem(ACCOUNT_A, {
      productId: 'product-1',
      quantity: 99,
      optionIds: [],
    });
    await expect(
      service.addItem(ACCOUNT_A, {
        productId: 'product-1',
        quantity: 1,
        optionIds: [],
      }),
    ).rejects.toMatchObject({
      code: CART_ERROR_CODES.CART_INVALID_QUANTITY,
    });
  });

  it('updates options atomically and leaves the old configuration on invalid replace', async () => {
    repo.snapshots.set('product-opt', configurableSnapshot());
    const created = await service.addItem(ACCOUNT_A, {
      productId: 'product-opt',
      quantity: 1,
      optionIds: ['o-large'],
    });
    const itemId = created.items[0]?.id;
    const updated = await service.updateItem(ACCOUNT_A, itemId, {
      quantity: 2,
      optionIds: ['o-small'],
    });
    expect(updated.items[0]?.quantity).toBe(2);
    expect(updated.items[0]?.selectedOptions[0]?.optionId).toBe('o-small');
    expect(updated.items[0]?.storedUnitPriceMinor).toBe(1000);
    await expect(
      service.updateItem(ACCOUNT_A, itemId, {
        quantity: 2,
        optionIds: [],
      }),
    ).rejects.toMatchObject({
      code: CART_ERROR_CODES.CART_REQUIRED_OPTION_MISSING,
    });
    const still = await service.getCart(ACCOUNT_A);
    expect(still.cart?.items[0]?.selectedOptions[0]?.optionId).toBe('o-small');
    expect(still.cart?.items[0]?.quantity).toBe(2);
  });

  it('accepts a zero-priced Product and rejects invalid quantity', async () => {
    repo.snapshots.set(
      'free',
      offerableSnapshot({
        productId: 'free',
        livePriceMinor: 0,
        name: 'Water',
      }),
    );
    const cart = await service.addItem(ACCOUNT_A, {
      productId: 'free',
      quantity: 1,
      optionIds: [],
    });
    expect(cart.cartSubtotalMinor).toBe(0);
    await expect(
      service.addItem(ACCOUNT_A, {
        productId: 'free',
        quantity: 0,
        optionIds: [],
      }),
    ).rejects.toMatchObject({
      code: CART_ERROR_CODES.CART_INVALID_QUANTITY,
    });
  });

  it('removes the Active Cart when the final item is deleted', async () => {
    repo.snapshots.set('product-1', offerableSnapshot());
    const created = await service.addItem(ACCOUNT_A, {
      productId: 'product-1',
      quantity: 1,
      optionIds: [],
    });
    const itemId = created.items[0]?.id;
    const updated = await service.updateItem(ACCOUNT_A, itemId, {
      quantity: 4,
    });
    expect(updated.items[0]?.quantity).toBe(4);
    const removed = await service.removeItem(ACCOUNT_A, itemId);
    expect(removed).toEqual({ cartExists: false, cart: null });
    expect(repo.carts).toHaveLength(0);
    repo.snapshots.set(
      'product-2',
      offerableSnapshot({
        productId: 'product-2',
        merchantBranchId: 'branch-2',
      }),
    );
    const next = await service.addItem(ACCOUNT_A, {
      productId: 'product-2',
      quantity: 1,
      optionIds: [],
    });
    expect(next.branchId).toBe('branch-2');
  });

  it('clears the Active Cart and its option relations', async () => {
    repo.snapshots.set('product-opt', configurableSnapshot());
    await service.addItem(ACCOUNT_A, {
      productId: 'product-opt',
      quantity: 1,
      optionIds: ['o-large'],
    });
    const cleared = await service.clearCart(ACCOUNT_A);
    expect(cleared).toEqual({ cartExists: false, cart: null });
    expect(repo.carts).toHaveLength(0);
    expect(repo.items).toHaveLength(0);
  });

  it('hides foreign CartItems as not found', async () => {
    repo.snapshots.set('product-1', offerableSnapshot());
    const owned = await service.addItem(ACCOUNT_A, {
      productId: 'product-1',
      quantity: 1,
      optionIds: [],
    });
    const itemId = owned.items[0]?.id;
    await expect(
      service.updateItem(ACCOUNT_B, itemId, { quantity: 2 }),
    ).rejects.toMatchObject({
      code: CART_ERROR_CODES.CART_ITEM_NOT_FOUND,
    });
    await expect(service.removeItem(ACCOUNT_B, itemId)).rejects.toMatchObject({
      code: CART_ERROR_CODES.CART_ITEM_NOT_FOUND,
    });
    const still = await service.getCart(ACCOUNT_A);
    expect(still.cart?.items).toHaveLength(1);
  });

  it('keeps stale CartItems and marks cartReady false when offerability or options break', async () => {
    repo.snapshots.set('product-opt', configurableSnapshot());
    await service.addItem(ACCOUNT_A, {
      productId: 'product-opt',
      quantity: 1,
      optionIds: ['o-large'],
    });
    const live = repo.snapshots.get('product-opt');
    if (live) {
      live.options = live.options.map((option) =>
        option.id === 'o-large' ? { ...option, available: false } : option,
      );
    }
    const unavailable = await service.getCart(ACCOUNT_A);
    expect(unavailable.cart?.items).toHaveLength(1);
    expect(unavailable.cart?.cartReady).toBe(false);
    expect(unavailable.cart?.warnings).toContain('CART_OPTION_NOT_AVAILABLE');
    repo.snapshots.set(
      'product-opt',
      configurableSnapshot({
        groups: [
          { id: 'g1', required: true, minSelections: 1, maxSelections: 1 },
        ],
        options: [],
      }),
    );
    const deleted = await service.getCart(ACCOUNT_A);
    expect(deleted.cart?.items).toHaveLength(1);
    expect(deleted.cart?.cartReady).toBe(false);
    repo.snapshots.set(
      'product-opt',
      configurableSnapshot({ productAvailable: false }),
    );
    const cart = await service.getCart(ACCOUNT_A);
    expect(cart.cart?.items[0]?.itemAvailable).toBe(false);
    expect(cart.cart?.warnings).toContain('CART_PRODUCT_NOT_AVAILABLE');
  });

  it('marks cartReady false for SUSPENDED Merchant, inactive Branch, and inactive Category', async () => {
    repo.snapshots.set('product-1', offerableSnapshot());
    await service.addItem(ACCOUNT_A, {
      productId: 'product-1',
      quantity: 1,
      optionIds: [],
    });
    repo.snapshots.set(
      'product-1',
      offerableSnapshot({
        merchantOperationalReady: false,
        merchantStatus: 'SUSPENDED',
      }),
    );
    expect((await service.getCart(ACCOUNT_A)).cart?.cartReady).toBe(false);
    repo.snapshots.set(
      'product-1',
      offerableSnapshot({
        branchOperationalStatus: 'INACTIVE',
        merchantOperationalReady: false,
      }),
    );
    expect((await service.getCart(ACCOUNT_A)).cart?.cartReady).toBe(false);
    repo.snapshots.set(
      'product-1',
      offerableSnapshot({ categoryActive: false }),
    );
    expect((await service.getCart(ACCOUNT_A)).cart?.cartReady).toBe(false);
  });
});
