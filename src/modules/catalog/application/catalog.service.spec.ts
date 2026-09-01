import { CatalogService } from './catalog.service';
import {
  CATALOG_ERROR_CODES,
  catalogProductInUse,
} from '../domain/catalog.errors';
import type {
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
import { MERCHANT_ERROR_CODES } from '../../merchants/domain/merchant.errors';
import {
  MERCHANT_MEMBER_ROLE_MANAGER,
  MERCHANT_MEMBER_ROLE_OWNER,
  MERCHANT_MEMBER_ROLE_STAFF,
  MERCHANT_STATUS_PENDING_REVIEW,
  MERCHANT_STATUS_SUSPENDED,
} from '../../merchants/domain/merchant.policy';
import type {
  MerchantBranchRecord,
  MerchantMemberRecord,
  MerchantRecord,
} from '../../merchants/domain/merchant.types';
import { MerchantAccessService } from '../../merchants/application/merchant-access.service';

const ACCOUNT_A = '11111111-1111-7111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-7222-8222-222222222222';
const ACCOUNT_MANAGER = '33333333-3333-7333-8333-333333333333';
const ACCOUNT_STAFF = '44444444-4444-7444-8444-444444444444';
const ACCOUNT_UNKNOWN = '55555555-5555-7555-8555-555555555555';

function now(): string {
  return new Date().toISOString();
}

class MemoryMerchantRepository {
  merchants = new Map<string, MerchantRecord>();
  members: MerchantMemberRecord[] = [];
  branches = new Map<string, MerchantBranchRecord[]>();

  findMembership(accountId: string, merchantId: string) {
    return Promise.resolve(
      this.members.find(
        (row) => row.accountId === accountId && row.merchantId === merchantId,
      ) ?? null,
    );
  }

  findMerchant(id: string) {
    return Promise.resolve(this.merchants.get(id) ?? null);
  }

  findOwnedBranch(merchantId: string, branchId: string) {
    return Promise.resolve(
      this.branches.get(merchantId)?.find((row) => row.id === branchId) ?? null,
    );
  }

  seedMerchant(accountId: string, name: string): MerchantRecord {
    const merchant: MerchantRecord = {
      id: `merchant-${this.merchants.size + 1}`,
      publicReference: `sgm_${this.merchants.size + 1}`,
      name,
      status: MERCHANT_STATUS_PENDING_REVIEW,
      verifiedAt: null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.merchants.set(merchant.id, merchant);
    this.members.push({
      id: `member-${merchant.id}`,
      merchantId: merchant.id,
      accountId,
      role: MERCHANT_MEMBER_ROLE_OWNER,
      createdAt: now(),
    });
    this.branches.set(merchant.id, []);
    return merchant;
  }

  addBranch(merchantId: string, name: string): MerchantBranchRecord {
    const list = this.branches.get(merchantId) ?? [];
    const branch: MerchantBranchRecord = {
      id: `branch-${list.length + 1}-${merchantId}`,
      merchantId,
      name,
      phone: '+213550000000',
      addressText: 'Street',
      latitude: 36.75,
      longitude: 3.05,
      operationalStatus: 'ACTIVE',
      createdAt: now(),
      updatedAt: now(),
    };
    list.push(branch);
    this.branches.set(merchantId, list);
    return branch;
  }

  addMember(merchantId: string, accountId: string, role: string) {
    this.members.push({
      id: `member-${accountId}`,
      merchantId,
      accountId,
      role,
      createdAt: now(),
    });
  }

  setStatus(merchantId: string, status: string) {
    const merchant = this.merchants.get(merchantId);
    if (merchant) {
      this.merchants.set(merchantId, { ...merchant, status });
    }
  }
}

class MemoryCatalogRepository {
  categories: CategoryRecord[] = [];
  products: ProductRecord[] = [];
  groups: OptionGroupRecord[] = [];
  options: OptionRecord[] = [];
  historicalProductIds = new Set<string>();

  markHistoricalUse(productId: string) {
    this.historicalProductIds.add(productId);
  }

  listCategories(branchId: string) {
    return Promise.resolve(
      this.categories.filter((row) => row.merchantBranchId === branchId),
    );
  }

  findCategory(id: string) {
    return Promise.resolve(
      this.categories.find((row) => row.id === id) ?? null,
    );
  }

  createCategory(branchId: string, input: CreateCategoryInput) {
    const row: CategoryRecord = {
      id: `category-${this.categories.length + 1}`,
      merchantBranchId: branchId,
      name: input.name,
      sortOrder: input.sortOrder ?? 0,
      active: input.active ?? true,
      createdAt: now(),
      updatedAt: now(),
    };
    this.categories.push(row);
    return Promise.resolve(row);
  }

  updateCategory(categoryId: string, input: UpdateCategoryInput) {
    const row = this.categories.find((item) => item.id === categoryId);
    if (!row) {
      return Promise.resolve(null);
    }
    if (input.name !== undefined) {
      row.name = input.name;
    }
    if (input.sortOrder !== undefined) {
      row.sortOrder = input.sortOrder;
    }
    if (input.active !== undefined) {
      row.active = input.active;
    }
    row.updatedAt = now();
    return Promise.resolve(row);
  }

  countProductsInCategory(categoryId: string) {
    return Promise.resolve(
      this.products.filter((row) => row.categoryId === categoryId).length,
    );
  }

  deleteCategory(categoryId: string) {
    const before = this.categories.length;
    this.categories = this.categories.filter((row) => row.id !== categoryId);
    return Promise.resolve(this.categories.length !== before);
  }

  listProducts(branchId: string, query: ProductListQuery) {
    let items = this.products.filter(
      (row) => row.merchantBranchId === branchId,
    );
    if (query.categoryId) {
      items = items.filter((row) => row.categoryId === query.categoryId);
    }
    if (query.available !== undefined) {
      items = items.filter((row) => row.available === query.available);
    }
    if (query.q) {
      items = items.filter((row) =>
        row.name.toLowerCase().includes(query.q!.toLowerCase()),
      );
    }
    const total = items.length;
    return Promise.resolve({
      items: items.slice(query.offset, query.offset + query.limit),
      total,
    });
  }

  findProduct(id: string) {
    return Promise.resolve(this.products.find((row) => row.id === id) ?? null);
  }

  createProduct(branchId: string, input: CreateProductInput) {
    const row: ProductRecord = {
      id: `product-${this.products.length + 1}`,
      merchantBranchId: branchId,
      categoryId: input.categoryId,
      name: input.name,
      description: input.description ?? null,
      priceMinor: input.priceMinor,
      available: input.available ?? true,
      createdAt: now(),
      updatedAt: now(),
    };
    this.products.push(row);
    return Promise.resolve(row);
  }

  updateProduct(productId: string, input: UpdateProductInput) {
    const row = this.products.find((item) => item.id === productId);
    if (!row) {
      return Promise.resolve(null);
    }
    if (input.categoryId !== undefined) {
      row.categoryId = input.categoryId;
    }
    if (input.name !== undefined) {
      row.name = input.name;
    }
    if (input.description !== undefined) {
      row.description = input.description;
    }
    if (input.priceMinor !== undefined) {
      row.priceMinor = input.priceMinor;
    }
    if (input.available !== undefined) {
      row.available = input.available;
    }
    row.updatedAt = now();
    return Promise.resolve(row);
  }

  deleteProduct(productId: string) {
    if (this.historicalProductIds.has(productId)) {
      throw catalogProductInUse();
    }
    const before = this.products.length;
    this.products = this.products.filter((row) => row.id !== productId);
    this.groups = this.groups.filter((row) => row.productId !== productId);
    return Promise.resolve(this.products.length !== before);
  }

  catalogStats(branchId: string) {
    const cats = this.categories.filter(
      (row) => row.merchantBranchId === branchId,
    );
    const prods = this.products.filter(
      (row) => row.merchantBranchId === branchId,
    );
    return Promise.resolve({
      categoryCount: cats.length,
      productCount: prods.length,
      availableProductCount: prods.filter((row) => row.available).length,
    });
  }

  listOptionGroups(productId: string) {
    return Promise.resolve(
      this.groups.filter((row) => row.productId === productId),
    );
  }

  findOptionGroup(id: string) {
    return Promise.resolve(this.groups.find((row) => row.id === id) ?? null);
  }

  createOptionGroup(productId: string, input: CreateOptionGroupInput) {
    const row: OptionGroupRecord = {
      id: `group-${this.groups.length + 1}`,
      productId,
      name: input.name,
      required: input.required,
      minSelections: input.minSelections,
      maxSelections: input.maxSelections,
      createdAt: now(),
      updatedAt: now(),
    };
    this.groups.push(row);
    return Promise.resolve(row);
  }

  updateOptionGroup(groupId: string, input: UpdateOptionGroupInput) {
    const row = this.groups.find((item) => item.id === groupId);
    if (!row) {
      return Promise.resolve(null);
    }
    Object.assign(row, input, { updatedAt: now() });
    return Promise.resolve(row);
  }

  deleteOptionGroup(groupId: string) {
    const before = this.groups.length;
    this.groups = this.groups.filter((row) => row.id !== groupId);
    this.options = this.options.filter((row) => row.optionGroupId !== groupId);
    return Promise.resolve(this.groups.length !== before);
  }

  listOptions(optionGroupId: string) {
    return Promise.resolve(
      this.options.filter((row) => row.optionGroupId === optionGroupId),
    );
  }

  listOptionsByGroupIds(groupIds: string[]) {
    return Promise.resolve(
      this.options.filter((row) => groupIds.includes(row.optionGroupId)),
    );
  }

  findOption(id: string) {
    return Promise.resolve(this.options.find((row) => row.id === id) ?? null);
  }

  createOption(optionGroupId: string, input: CreateOptionInput) {
    const row: OptionRecord = {
      id: `option-${this.options.length + 1}`,
      optionGroupId,
      name: input.name,
      additionalPriceMinor: input.additionalPriceMinor,
      available: input.available ?? true,
      createdAt: now(),
      updatedAt: now(),
    };
    this.options.push(row);
    return Promise.resolve(row);
  }

  updateOption(optionId: string, input: UpdateOptionInput) {
    const row = this.options.find((item) => item.id === optionId);
    if (!row) {
      return Promise.resolve(null);
    }
    Object.assign(row, input, { updatedAt: now() });
    return Promise.resolve(row);
  }

  deleteOption(optionId: string) {
    const before = this.options.length;
    this.options = this.options.filter((row) => row.id !== optionId);
    return Promise.resolve(this.options.length !== before);
  }
}

describe('Catalog foundation services', () => {
  let merchants: MemoryMerchantRepository;
  let catalog: MemoryCatalogRepository;
  let service: CatalogService;

  beforeEach(() => {
    merchants = new MemoryMerchantRepository();
    catalog = new MemoryCatalogRepository();
    const access = new MerchantAccessService(merchants as never);
    service = new CatalogService(catalog as never, access, merchants as never);
  });

  function seedOwned() {
    const merchant = merchants.seedMerchant(ACCOUNT_A, 'Cafe A');
    const branch = merchants.addBranch(merchant.id, 'Main');
    return { merchant, branch };
  }

  it('rejects Category/Product creation without a valid owned Branch', async () => {
    const merchant = merchants.seedMerchant(ACCOUNT_A, 'Cafe A');
    await expect(
      service.createCategory(
        ACCOUNT_A,
        merchant.id,
        '11111111-1111-7111-8111-111111111111',
        { name: 'Drinks' },
      ),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_BRANCH_NOT_FOUND,
    });
    const other = merchants.seedMerchant(ACCOUNT_B, 'Cafe B');
    const foreignBranch = merchants.addBranch(other.id, 'Theirs');
    await expect(
      service.createCategory(ACCOUNT_A, merchant.id, foreignBranch.id, {
        name: 'Stolen',
      }),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_BRANCH_NOT_FOUND,
    });
  });

  it('allows duplicate Category and Product names on the same Branch', async () => {
    const { merchant, branch } = seedOwned();
    const first = await service.createCategory(
      ACCOUNT_A,
      merchant.id,
      branch.id,
      { name: 'Drinks' },
    );
    const second = await service.createCategory(
      ACCOUNT_A,
      merchant.id,
      branch.id,
      { name: 'Drinks' },
    );
    expect(first.id).not.toBe(second.id);
    const productA = await service.createProduct(
      ACCOUNT_A,
      merchant.id,
      branch.id,
      { categoryId: first.id, name: 'Coffee', priceMinor: 100 },
    );
    const productB = await service.createProduct(
      ACCOUNT_A,
      merchant.id,
      branch.id,
      { categoryId: first.id, name: 'Coffee', priceMinor: 200 },
    );
    expect(productA.id).not.toBe(productB.id);
  });

  it('keeps unavailable Products and Options stored and editable', async () => {
    const { merchant, branch } = seedOwned();
    const category = await service.createCategory(
      ACCOUNT_A,
      merchant.id,
      branch.id,
      { name: 'Drinks' },
    );
    const product = await service.createProduct(
      ACCOUNT_A,
      merchant.id,
      branch.id,
      {
        categoryId: category.id,
        name: 'Coffee',
        priceMinor: 100,
        available: false,
      },
    );
    expect(product.available).toBe(false);
    const updated = await service.updateProduct(
      ACCOUNT_A,
      merchant.id,
      product.id,
      { name: 'Espresso', available: false },
    );
    expect(updated.name).toBe('Espresso');
    expect(updated.available).toBe(false);
    const group = await service.createOptionGroup(
      ACCOUNT_A,
      merchant.id,
      product.id,
      { name: 'Size', required: true, minSelections: 1, maxSelections: 1 },
    );
    const option = await service.createOption(
      ACCOUNT_A,
      merchant.id,
      product.id,
      group.id,
      { name: 'Large', additionalPriceMinor: 0, available: false },
    );
    expect(option.available).toBe(false);
    const listed = await service.listProducts(
      ACCOUNT_A,
      merchant.id,
      branch.id,
      {
        available: false,
        limit: 50,
        offset: 0,
      },
    );
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.id).toBe(product.id);
  });

  it('deletes unused Products and refuses historical OrderItem use', async () => {
    const { merchant, branch } = seedOwned();
    const category = await service.createCategory(
      ACCOUNT_A,
      merchant.id,
      branch.id,
      { name: 'Drinks' },
    );
    const unused = await service.createProduct(
      ACCOUNT_A,
      merchant.id,
      branch.id,
      { categoryId: category.id, name: 'Tea', priceMinor: 50 },
    );
    const used = await service.createProduct(
      ACCOUNT_A,
      merchant.id,
      branch.id,
      { categoryId: category.id, name: 'Coffee', priceMinor: 100 },
    );
    catalog.markHistoricalUse(used.id);
    await expect(
      service.deleteProduct(ACCOUNT_A, merchant.id, used.id),
    ).rejects.toMatchObject({
      code: CATALOG_ERROR_CODES.CATALOG_PRODUCT_IN_USE,
    });
    expect(await catalog.findProduct(used.id)).not.toBeNull();
    await expect(
      service.deleteProduct(ACCOUNT_A, merchant.id, unused.id),
    ).resolves.toEqual({ deleted: true });
    expect(await catalog.findProduct(unused.id)).toBeNull();
  });

  it('lets OWNER create and list catalog on PENDING_REVIEW without operational impact', async () => {
    const { merchant, branch } = seedOwned();
    const category = await service.createCategory(
      ACCOUNT_A,
      merchant.id,
      branch.id,
      { name: 'Drinks' },
    );
    const product = await service.createProduct(
      ACCOUNT_A,
      merchant.id,
      branch.id,
      { categoryId: category.id, name: 'Coffee', priceMinor: 0 },
    );
    expect(product.priceMinor).toBe(0);
    expect(product.available).toBe(true);
    const boot = await service.bootstrap(ACCOUNT_A, merchant.id, branch.id);
    expect(boot.stats.categoryCount).toBe(1);
    expect(boot.stats.productCount).toBe(1);
    expect(boot.stats.availableProductCount).toBe(1);
  });

  it('lets MANAGER manage catalog and STAFF only read', async () => {
    const { merchant, branch } = seedOwned();
    merchants.addMember(
      merchant.id,
      ACCOUNT_MANAGER,
      MERCHANT_MEMBER_ROLE_MANAGER,
    );
    merchants.addMember(merchant.id, ACCOUNT_STAFF, MERCHANT_MEMBER_ROLE_STAFF);
    const category = await service.createCategory(
      ACCOUNT_MANAGER,
      merchant.id,
      branch.id,
      { name: 'Food' },
    );
    await expect(
      service.createCategory(ACCOUNT_STAFF, merchant.id, branch.id, {
        name: 'Nope',
      }),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
    });
    const listed = await service.listCategories(
      ACCOUNT_STAFF,
      merchant.id,
      branch.id,
    );
    expect(listed.categories).toHaveLength(1);
    expect(listed.categories[0]?.id).toBe(category.id);
  });

  it('denies foreign Merchant access and unknown roles', async () => {
    const owned = seedOwned();
    const other = merchants.seedMerchant(ACCOUNT_B, 'Cafe B');
    merchants.addMember(owned.merchant.id, ACCOUNT_UNKNOWN, 'CREATOR');
    await expect(
      service.createCategory(ACCOUNT_B, owned.merchant.id, owned.branch.id, {
        name: 'Steal',
      }),
    ).rejects.toMatchObject({ code: MERCHANT_ERROR_CODES.MERCHANT_NOT_FOUND });
    await expect(
      service.createCategory(
        ACCOUNT_UNKNOWN,
        owned.merchant.id,
        owned.branch.id,
        {
          name: 'Nope',
        },
      ),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
    });
    expect(other.id).not.toBe(owned.merchant.id);
  });

  it('denies SUSPENDED and unknown Merchant status mutations', async () => {
    const { merchant, branch } = seedOwned();
    merchants.setStatus(merchant.id, MERCHANT_STATUS_SUSPENDED);
    await expect(
      service.createCategory(ACCOUNT_A, merchant.id, branch.id, { name: 'X' }),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_STATUS_RESTRICTED,
    });
    merchants.setStatus(merchant.id, 'WEIRD');
    await expect(
      service.createCategory(ACCOUNT_A, merchant.id, branch.id, { name: 'X' }),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_STATUS_RESTRICTED,
    });
  });

  it('rejects Category delete while Products exist and cross-branch category use', async () => {
    const { merchant, branch } = seedOwned();
    const otherBranch = merchants.addBranch(merchant.id, 'Other');
    const category = await service.createCategory(
      ACCOUNT_A,
      merchant.id,
      branch.id,
      { name: 'A' },
    );
    await service.createProduct(ACCOUNT_A, merchant.id, branch.id, {
      categoryId: category.id,
      name: 'P',
      priceMinor: 100,
    });
    await expect(
      service.deleteCategory(ACCOUNT_A, merchant.id, category.id),
    ).rejects.toMatchObject({
      code: CATALOG_ERROR_CODES.CATALOG_CATEGORY_IN_USE,
    });
    const otherCategory = await service.createCategory(
      ACCOUNT_A,
      merchant.id,
      otherBranch.id,
      { name: 'B' },
    );
    await expect(
      service.createProduct(ACCOUNT_A, merchant.id, branch.id, {
        categoryId: otherCategory.id,
        name: 'Mismatch',
        priceMinor: 100,
      }),
    ).rejects.toMatchObject({
      code: CATALOG_ERROR_CODES.CATALOG_CATEGORY_NOT_FOUND,
    });
  });

  it('rejects invalid prices and option group rules', async () => {
    const { merchant, branch } = seedOwned();
    const category = await service.createCategory(
      ACCOUNT_A,
      merchant.id,
      branch.id,
      { name: 'A' },
    );
    await expect(
      service.createProduct(ACCOUNT_A, merchant.id, branch.id, {
        categoryId: category.id,
        name: 'Bad',
        priceMinor: -5,
      }),
    ).rejects.toMatchObject({
      code: CATALOG_ERROR_CODES.CATALOG_INVALID_PRICE,
    });
    const product = await service.createProduct(
      ACCOUNT_A,
      merchant.id,
      branch.id,
      { categoryId: category.id, name: 'Good', priceMinor: 250 },
    );
    await expect(
      service.createOptionGroup(ACCOUNT_A, merchant.id, product.id, {
        name: 'Size',
        required: true,
        minSelections: 0,
        maxSelections: 1,
      }),
    ).rejects.toMatchObject({
      code: CATALOG_ERROR_CODES.CATALOG_OPTION_GROUP_INVALID,
    });
    const group = await service.createOptionGroup(
      ACCOUNT_A,
      merchant.id,
      product.id,
      { name: 'Size', required: true, minSelections: 1, maxSelections: 1 },
    );
    const option = await service.createOption(
      ACCOUNT_A,
      merchant.id,
      product.id,
      group.id,
      { name: 'Large', additionalPriceMinor: 0 },
    );
    expect(option.additionalPriceMinor).toBe(0);
    await expect(
      service.createOptionGroup(ACCOUNT_A, merchant.id, product.id, {
        name: 'Addons',
        required: false,
        minSelections: 1,
        maxSelections: 2,
      }),
    ).rejects.toMatchObject({
      code: CATALOG_ERROR_CODES.CATALOG_OPTION_GROUP_INVALID,
    });
    await expect(
      service.createOptionGroup(ACCOUNT_A, merchant.id, product.id, {
        name: 'Addons',
        required: false,
        minSelections: 0,
        maxSelections: 0,
      }),
    ).rejects.toMatchObject({
      code: CATALOG_ERROR_CODES.CATALOG_OPTION_GROUP_INVALID,
    });
    await expect(
      service.createOptionGroup(ACCOUNT_A, merchant.id, product.id, {
        name: 'Addons',
        required: true,
        minSelections: 2,
        maxSelections: 1,
      }),
    ).rejects.toMatchObject({
      code: CATALOG_ERROR_CODES.CATALOG_OPTION_GROUP_INVALID,
    });
    await expect(
      service.createOption(ACCOUNT_A, merchant.id, product.id, group.id, {
        name: 'Discount',
        additionalPriceMinor: -1,
      }),
    ).rejects.toMatchObject({
      code: CATALOG_ERROR_CODES.CATALOG_INVALID_PRICE,
    });
    const extras = await service.createOptionGroup(
      ACCOUNT_A,
      merchant.id,
      product.id,
      { name: 'Extras', required: false, minSelections: 0, maxSelections: 2 },
    );
    expect(extras.minSelections).toBe(0);
    expect(extras.maxSelections).toBe(2);
    await service.updateOption(
      ACCOUNT_A,
      merchant.id,
      product.id,
      group.id,
      option.id,
      { additionalPriceMinor: 200 },
    );
    await service.deleteOption(
      ACCOUNT_A,
      merchant.id,
      product.id,
      group.id,
      option.id,
    );
  });

  it('hides foreign products as not found', async () => {
    const owned = seedOwned();
    const other = merchants.seedMerchant(ACCOUNT_B, 'B');
    const otherBranch = merchants.addBranch(other.id, 'B1');
    const category = await service.createCategory(
      ACCOUNT_B,
      other.id,
      otherBranch.id,
      { name: 'Secret' },
    );
    const product = await service.createProduct(
      ACCOUNT_B,
      other.id,
      otherBranch.id,
      { categoryId: category.id, name: 'Hidden', priceMinor: 1 },
    );
    await expect(
      service.getProduct(ACCOUNT_A, owned.merchant.id, product.id),
    ).rejects.toMatchObject({
      code: CATALOG_ERROR_CODES.CATALOG_PRODUCT_NOT_FOUND,
    });
    await expect(
      service.updateProduct(ACCOUNT_A, owned.merchant.id, product.id, {
        name: 'Hijack',
      }),
    ).rejects.toMatchObject({
      code: CATALOG_ERROR_CODES.CATALOG_PRODUCT_NOT_FOUND,
    });
  });
});
