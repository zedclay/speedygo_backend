import { Injectable } from '@nestjs/common';
import { customerProfileNotFound } from '../../customers/domain/customer.errors';
import {
  customerProductNotFound,
  customerStorefrontNotFound,
} from '../domain/customer-catalog.errors';
import {
  normalizeCustomerCatalogPagination,
  normalizeCustomerCatalogSearchQuery,
  resolveCustomerCatalogSort,
} from '../domain/customer-catalog.policy';
import type {
  CustomerCatalogPage,
  CustomerCatalogSearchResult,
  CustomerCategorySummary,
  CustomerProductDetail,
  CustomerProductSummary,
  CustomerStorefrontDetail,
  CustomerStorefrontSummary,
} from '../domain/customer-catalog.types';
import { CustomerCatalogRepository } from '../infrastructure/customer-catalog.repository';

@Injectable()
export class CustomerCatalogService {
  constructor(private readonly catalog: CustomerCatalogRepository) {}

  async listStorefronts(
    accountId: string,
    query: { limit?: number; offset?: number; sort?: string },
  ): Promise<CustomerCatalogPage<CustomerStorefrontSummary>> {
    await this.requireCustomerProfile(accountId);
    resolveCustomerCatalogSort(query.sort);
    const page = normalizeCustomerCatalogPagination(query);
    return this.catalog.listStorefronts(page);
  }

  async getStorefront(
    accountId: string,
    branchId: string,
  ): Promise<CustomerStorefrontDetail> {
    await this.requireCustomerProfile(accountId);
    const storefront = await this.catalog.findVisibleStorefront(branchId);
    if (!storefront) {
      throw customerStorefrontNotFound();
    }
    return storefront;
  }

  async listCategories(
    accountId: string,
    branchId: string,
  ): Promise<{ branchId: string; items: CustomerCategorySummary[] }> {
    await this.requireCustomerProfile(accountId);
    const storefront = await this.catalog.findVisibleStorefront(branchId);
    if (!storefront) {
      throw customerStorefrontNotFound();
    }
    const items = await this.catalog.listVisibleCategories(branchId);
    return { branchId, items };
  }

  async listProducts(
    accountId: string,
    branchId: string,
    query: {
      limit?: number;
      offset?: number;
      categoryId?: string;
      sort?: string;
    },
  ): Promise<CustomerCatalogPage<CustomerProductSummary>> {
    await this.requireCustomerProfile(accountId);
    resolveCustomerCatalogSort(query.sort);
    const page = normalizeCustomerCatalogPagination(query);
    const storefront = await this.catalog.findVisibleStorefront(branchId);
    if (!storefront) {
      throw customerStorefrontNotFound();
    }
    return this.catalog.listVisibleProducts({
      branchId,
      categoryId: query.categoryId,
      ...page,
    });
  }

  async getProduct(
    accountId: string,
    branchId: string,
    productId: string,
  ): Promise<CustomerProductDetail> {
    await this.requireCustomerProfile(accountId);
    const product = await this.catalog.findVisibleProductDetail(
      branchId,
      productId,
    );
    if (!product) {
      throw customerProductNotFound();
    }
    return product;
  }

  async search(
    accountId: string,
    query: { q: string; limit?: number; offset?: number; sort?: string },
  ): Promise<CustomerCatalogSearchResult> {
    await this.requireCustomerProfile(accountId);
    resolveCustomerCatalogSort(query.sort);
    const normalizedQ = normalizeCustomerCatalogSearchQuery(query.q);
    const page = normalizeCustomerCatalogPagination(query);
    return this.catalog.search({ query: normalizedQ, ...page });
  }

  private async requireCustomerProfile(accountId: string): Promise<string> {
    const profileId = await this.catalog.findProfileIdByAccountId(accountId);
    if (!profileId) {
      throw customerProfileNotFound();
    }
    return profileId;
  }
}
