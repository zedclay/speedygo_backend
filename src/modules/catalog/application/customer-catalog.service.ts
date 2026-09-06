import { Inject, Injectable } from '@nestjs/common';
import {
  CHECKOUT_CLOCK,
  type CheckoutClock,
} from '../../checkout/domain/checkout.clock';
import { customerProfileNotFound } from '../../customers/domain/customer.errors';
import { OpeningHoursService } from '../../merchants/application/opening-hours.service';
import { OPENING_HOURS_TIMEZONE } from '../../merchants/domain/opening-hours.constants';
import type { OpeningHoursEvaluation } from '../../merchants/domain/opening-hours.evaluator';
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
  constructor(
    private readonly catalog: CustomerCatalogRepository,
    private readonly openingHours: OpeningHoursService,
    @Inject(CHECKOUT_CLOCK) private readonly clock: CheckoutClock,
  ) {}

  async listStorefronts(
    accountId: string,
    query: { limit?: number; offset?: number; sort?: string },
  ): Promise<CustomerCatalogPage<CustomerStorefrontSummary>> {
    await this.requireCustomerProfile(accountId);
    resolveCustomerCatalogSort(query.sort);
    const page = normalizeCustomerCatalogPagination(query);
    const result = await this.catalog.listStorefronts(page);
    const now = this.clock.now();
    const hours = await this.openingHours.evaluateBranches(
      result.items.map((item) => item.branchId),
      now,
    );
    return {
      ...result,
      items: result.items.map((item) =>
        this.mergeHours(item, hours.get(item.branchId)),
      ),
    };
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
    const now = this.clock.now();
    const projection = await this.openingHours.getCustomerProjection(
      branchId,
      now,
      { includeDays: true },
    );
    return {
      ...this.mergeHours(storefront, projection),
      days: projection.days ?? [],
    };
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
    const result = await this.catalog.search({
      query: normalizedQ,
      ...page,
    });
    const branchIds = [
      ...new Set(result.items.map((hit) => hit.storefront.branchId)),
    ];
    const now = this.clock.now();
    const hours = await this.openingHours.evaluateBranches(branchIds, now);
    return {
      ...result,
      items: result.items.map((hit) => ({
        ...hit,
        storefront: this.mergeHours(
          hit.storefront,
          hours.get(hit.storefront.branchId),
        ),
      })),
    };
  }

  private mergeHours(
    storefront: Omit<
      CustomerStorefrontSummary,
      | 'hoursConfigured'
      | 'isOpenNow'
      | 'timezone'
      | 'currentClosesAt'
      | 'nextOpenAt'
    > &
      Partial<CustomerStorefrontSummary>,
    evaluation: OpeningHoursEvaluation | undefined,
  ): CustomerStorefrontSummary {
    const hours = evaluation ?? {
      hoursConfigured: false,
      isOpenNow: false,
      timezone: OPENING_HOURS_TIMEZONE,
      currentClosesAt: null,
      nextOpenAt: null,
    };
    return {
      branchId: storefront.branchId,
      branchName: storefront.branchName,
      addressText: storefront.addressText,
      latitude: storefront.latitude,
      longitude: storefront.longitude,
      merchantId: storefront.merchantId,
      merchantName: storefront.merchantName,
      merchantPublicReference: storefront.merchantPublicReference,
      hoursConfigured: hours.hoursConfigured,
      isOpenNow: hours.isOpenNow,
      timezone: hours.timezone,
      currentClosesAt: hours.currentClosesAt
        ? hours.currentClosesAt.toISOString()
        : null,
      nextOpenAt: hours.nextOpenAt ? hours.nextOpenAt.toISOString() : null,
    };
  }

  private async requireCustomerProfile(accountId: string): Promise<string> {
    const profileId = await this.catalog.findProfileIdByAccountId(accountId);
    if (!profileId) {
      throw customerProfileNotFound();
    }
    return profileId;
  }
}
