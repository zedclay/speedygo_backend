import { Injectable } from '@nestjs/common';
import { merchantBranchNotFound } from '../../merchants/domain/merchant.errors';
import { MERCHANT_CAPABILITIES } from '../../merchants/domain/merchant.policy';
import { MerchantAccessService } from '../../merchants/application/merchant-access.service';
import { MerchantRepository } from '../../merchants/infrastructure/merchant.repository';
import {
  catalogCategoryNotFound,
  catalogOptionGroupNotFound,
  catalogOptionNotFound,
  catalogProductNotFound,
  catalogCategoryInUse,
} from '../domain/catalog.errors';
import {
  CATALOG_PRODUCT_LIST_DEFAULT_LIMIT,
  requireCatalogPriceMinor,
  requireOptionGroupRules,
} from '../domain/catalog.policy';
import {
  toCategoryView,
  toOptionGroupView,
  toOptionView,
  toProductSummaryView,
  type CatalogBootstrapView,
  type CategoryView,
  type CreateCategoryInput,
  type CreateOptionGroupInput,
  type CreateOptionInput,
  type CreateProductInput,
  type OptionGroupView,
  type OptionView,
  type ProductDetailView,
  type ProductListQuery,
  type ProductListView,
  type ProductRecord,
  type UpdateCategoryInput,
  type UpdateOptionGroupInput,
  type UpdateOptionInput,
  type UpdateProductInput,
} from '../domain/catalog.types';
import { CatalogRepository } from '../infrastructure/catalog.repository';

@Injectable()
export class CatalogService {
  constructor(
    private readonly catalog: CatalogRepository,
    private readonly access: MerchantAccessService,
    private readonly merchants: MerchantRepository,
  ) {}

  async bootstrap(
    accountId: string,
    merchantId: string,
    branchId: string,
  ): Promise<CatalogBootstrapView> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.CATALOG_READ,
    );
    await this.requireOwnedBranch(merchantId, branchId);
    const [categories, stats] = await Promise.all([
      this.catalog.listCategories(branchId),
      this.catalog.catalogStats(branchId),
    ]);
    return {
      branchId,
      stats,
      categories: categories.map(toCategoryView),
    };
  }

  async listCategories(
    accountId: string,
    merchantId: string,
    branchId: string,
  ): Promise<{ categories: CategoryView[] }> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.CATALOG_READ,
    );
    await this.requireOwnedBranch(merchantId, branchId);
    const categories = await this.catalog.listCategories(branchId);
    return { categories: categories.map(toCategoryView) };
  }

  async createCategory(
    accountId: string,
    merchantId: string,
    branchId: string,
    input: CreateCategoryInput,
  ): Promise<CategoryView> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.CATEGORY_MANAGE,
    );
    await this.requireOwnedBranch(merchantId, branchId);
    const created = await this.catalog.createCategory(branchId, input);
    return toCategoryView(created);
  }

  async updateCategory(
    accountId: string,
    merchantId: string,
    categoryId: string,
    input: UpdateCategoryInput,
  ): Promise<CategoryView> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.CATEGORY_MANAGE,
    );
    const category = await this.requireOwnedCategory(merchantId, categoryId);
    const updated = await this.catalog.updateCategory(category.id, input);
    if (!updated) {
      throw catalogCategoryNotFound();
    }
    return toCategoryView(updated);
  }

  async deleteCategory(
    accountId: string,
    merchantId: string,
    categoryId: string,
  ): Promise<{ deleted: true }> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.CATEGORY_MANAGE,
    );
    const category = await this.requireOwnedCategory(merchantId, categoryId);
    const productCount = await this.catalog.countProductsInCategory(
      category.id,
    );
    if (productCount > 0) {
      throw catalogCategoryInUse();
    }
    const deleted = await this.catalog.deleteCategory(category.id);
    if (!deleted) {
      throw catalogCategoryNotFound();
    }
    return { deleted: true };
  }

  async listProducts(
    accountId: string,
    merchantId: string,
    branchId: string,
    query: Omit<ProductListQuery, 'limit' | 'offset'> & {
      limit?: number;
      offset?: number;
    },
  ): Promise<ProductListView> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.CATALOG_READ,
    );
    await this.requireOwnedBranch(merchantId, branchId);
    if (query.categoryId) {
      const category = await this.requireOwnedCategory(
        merchantId,
        query.categoryId,
      );
      if (category.merchantBranchId !== branchId) {
        throw catalogCategoryNotFound();
      }
    }
    const limit = query.limit ?? CATALOG_PRODUCT_LIST_DEFAULT_LIMIT;
    const offset = query.offset ?? 0;
    const result = await this.catalog.listProducts(branchId, {
      categoryId: query.categoryId,
      available: query.available,
      q: query.q,
      limit,
      offset,
    });
    return {
      items: result.items.map(toProductSummaryView),
      limit,
      offset,
      total: result.total,
    };
  }

  async getProduct(
    accountId: string,
    merchantId: string,
    productId: string,
  ): Promise<ProductDetailView> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.CATALOG_READ,
    );
    const product = await this.requireOwnedProduct(merchantId, productId);
    return this.toProductDetail(product);
  }

  async createProduct(
    accountId: string,
    merchantId: string,
    branchId: string,
    input: CreateProductInput,
  ): Promise<ProductDetailView> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.PRODUCT_MANAGE,
    );
    await this.requireOwnedBranch(merchantId, branchId);
    requireCatalogPriceMinor(input.priceMinor);
    const category = await this.requireOwnedCategory(
      merchantId,
      input.categoryId,
    );
    if (category.merchantBranchId !== branchId) {
      throw catalogCategoryNotFound();
    }
    const created = await this.catalog.createProduct(branchId, {
      ...input,
      description: this.normalizeDescription(input.description),
    });
    return this.toProductDetail(created);
  }

  async updateProduct(
    accountId: string,
    merchantId: string,
    productId: string,
    input: UpdateProductInput,
  ): Promise<ProductDetailView> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.PRODUCT_MANAGE,
    );
    const product = await this.requireOwnedProduct(merchantId, productId);
    if (input.priceMinor !== undefined) {
      requireCatalogPriceMinor(input.priceMinor);
    }
    if (input.categoryId !== undefined) {
      const category = await this.requireOwnedCategory(
        merchantId,
        input.categoryId,
      );
      if (category.merchantBranchId !== product.merchantBranchId) {
        throw catalogCategoryNotFound();
      }
    }
    const updated = await this.catalog.updateProduct(product.id, {
      ...input,
      description:
        input.description !== undefined
          ? this.normalizeDescription(input.description)
          : undefined,
    });
    if (!updated) {
      throw catalogProductNotFound();
    }
    return this.toProductDetail(updated);
  }

  async deleteProduct(
    accountId: string,
    merchantId: string,
    productId: string,
  ): Promise<{ deleted: true }> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.PRODUCT_MANAGE,
    );
    const product = await this.requireOwnedProduct(merchantId, productId);
    const deleted = await this.catalog.deleteProduct(product.id);
    if (!deleted) {
      throw catalogProductNotFound();
    }
    return { deleted: true };
  }

  async listOptionGroups(
    accountId: string,
    merchantId: string,
    productId: string,
  ): Promise<{ optionGroups: OptionGroupView[] }> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.CATALOG_READ,
    );
    const product = await this.requireOwnedProduct(merchantId, productId);
    const groups = await this.catalog.listOptionGroups(product.id);
    const options = await this.catalog.listOptionsByGroupIds(
      groups.map((group) => group.id),
    );
    return {
      optionGroups: groups.map((group) =>
        toOptionGroupView(
          group,
          options.filter((option) => option.optionGroupId === group.id),
        ),
      ),
    };
  }

  async createOptionGroup(
    accountId: string,
    merchantId: string,
    productId: string,
    input: CreateOptionGroupInput,
  ): Promise<OptionGroupView> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.PRODUCT_OPTIONS_MANAGE,
    );
    const product = await this.requireOwnedProduct(merchantId, productId);
    requireOptionGroupRules(input);
    const created = await this.catalog.createOptionGroup(product.id, input);
    return toOptionGroupView(created, []);
  }

  async updateOptionGroup(
    accountId: string,
    merchantId: string,
    productId: string,
    groupId: string,
    input: UpdateOptionGroupInput,
  ): Promise<OptionGroupView> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.PRODUCT_OPTIONS_MANAGE,
    );
    const group = await this.requireOwnedOptionGroup(
      merchantId,
      productId,
      groupId,
    );
    const next = {
      required: input.required ?? group.required,
      minSelections: input.minSelections ?? group.minSelections,
      maxSelections: input.maxSelections ?? group.maxSelections,
    };
    requireOptionGroupRules(next);
    const updated = await this.catalog.updateOptionGroup(group.id, input);
    if (!updated) {
      throw catalogOptionGroupNotFound();
    }
    const options = await this.catalog.listOptions(updated.id);
    return toOptionGroupView(updated, options);
  }

  async deleteOptionGroup(
    accountId: string,
    merchantId: string,
    productId: string,
    groupId: string,
  ): Promise<{ deleted: true }> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.PRODUCT_OPTIONS_MANAGE,
    );
    const group = await this.requireOwnedOptionGroup(
      merchantId,
      productId,
      groupId,
    );
    const deleted = await this.catalog.deleteOptionGroup(group.id);
    if (!deleted) {
      throw catalogOptionGroupNotFound();
    }
    return { deleted: true };
  }

  async createOption(
    accountId: string,
    merchantId: string,
    productId: string,
    groupId: string,
    input: CreateOptionInput,
  ): Promise<OptionView> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.PRODUCT_OPTIONS_MANAGE,
    );
    const group = await this.requireOwnedOptionGroup(
      merchantId,
      productId,
      groupId,
    );
    requireCatalogPriceMinor(input.additionalPriceMinor);
    const created = await this.catalog.createOption(group.id, input);
    return toOptionView(created);
  }

  async updateOption(
    accountId: string,
    merchantId: string,
    productId: string,
    groupId: string,
    optionId: string,
    input: UpdateOptionInput,
  ): Promise<OptionView> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.PRODUCT_OPTIONS_MANAGE,
    );
    await this.requireOwnedOptionGroup(merchantId, productId, groupId);
    const option = await this.catalog.findOption(optionId);
    if (!option || option.optionGroupId !== groupId) {
      throw catalogOptionNotFound();
    }
    if (input.additionalPriceMinor !== undefined) {
      requireCatalogPriceMinor(input.additionalPriceMinor);
    }
    const updated = await this.catalog.updateOption(option.id, input);
    if (!updated) {
      throw catalogOptionNotFound();
    }
    return toOptionView(updated);
  }

  async deleteOption(
    accountId: string,
    merchantId: string,
    productId: string,
    groupId: string,
    optionId: string,
  ): Promise<{ deleted: true }> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.PRODUCT_OPTIONS_MANAGE,
    );
    await this.requireOwnedOptionGroup(merchantId, productId, groupId);
    const option = await this.catalog.findOption(optionId);
    if (!option || option.optionGroupId !== groupId) {
      throw catalogOptionNotFound();
    }
    const deleted = await this.catalog.deleteOption(option.id);
    if (!deleted) {
      throw catalogOptionNotFound();
    }
    return { deleted: true };
  }

  private async requireOwnedBranch(merchantId: string, branchId: string) {
    const branch = await this.merchants.findOwnedBranch(merchantId, branchId);
    if (!branch) {
      throw merchantBranchNotFound();
    }
    return branch;
  }

  private async requireOwnedCategory(merchantId: string, categoryId: string) {
    const category = await this.catalog.findCategory(categoryId);
    if (!category) {
      throw catalogCategoryNotFound();
    }
    const branch = await this.merchants.findOwnedBranch(
      merchantId,
      category.merchantBranchId,
    );
    if (!branch) {
      throw catalogCategoryNotFound();
    }
    return category;
  }

  private async requireOwnedProduct(merchantId: string, productId: string) {
    const product = await this.catalog.findProduct(productId);
    if (!product) {
      throw catalogProductNotFound();
    }
    const branch = await this.merchants.findOwnedBranch(
      merchantId,
      product.merchantBranchId,
    );
    if (!branch) {
      throw catalogProductNotFound();
    }
    return product;
  }

  private async requireOwnedOptionGroup(
    merchantId: string,
    productId: string,
    groupId: string,
  ) {
    const product = await this.requireOwnedProduct(merchantId, productId);
    const group = await this.catalog.findOptionGroup(groupId);
    if (!group || group.productId !== product.id) {
      throw catalogOptionGroupNotFound();
    }
    return group;
  }

  private async toProductDetail(
    product: ProductRecord,
  ): Promise<ProductDetailView> {
    const groups = await this.catalog.listOptionGroups(product.id);
    const options = await this.catalog.listOptionsByGroupIds(
      groups.map((group) => group.id),
    );
    return {
      ...toProductSummaryView(product),
      optionGroups: groups.map((group) =>
        toOptionGroupView(
          group,
          options.filter((option) => option.optionGroupId === group.id),
        ),
      ),
    };
  }

  private normalizeDescription(
    description: string | null | undefined,
  ): string | null {
    if (description === undefined || description === null) {
      return null;
    }
    const trimmed = description.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
}
