import { Inject, Injectable } from '@nestjs/common';
import {
  CHECKOUT_CLOCK,
  type CheckoutClock,
} from '../../checkout/domain/checkout.clock';
import {
  customerAddressNotFound,
  customerProfileNotFound,
} from '../../customers/domain/customer.errors';
import { hasValidCoordinates } from '../../customers/domain/customer.types';
import { GeoService } from '../../geo/application/geo.service';
import { MerchantProductImageService } from './merchant-product-image.service';
import { MerchantBranchCoverService } from '../../merchants/application/merchant-branch-cover.service';
import { OpeningHoursService } from '../../merchants/application/opening-hours.service';
import { OPENING_HOURS_TIMEZONE } from '../../merchants/domain/opening-hours.constants';
import type { OpeningHoursEvaluation } from '../../merchants/domain/opening-hours.evaluator';
import { captureOpenNowLocalParts } from '../../merchants/domain/opening-hours.open-now-filter';
import {
  commerceVerticalInactive,
  commerceVerticalNotFound,
} from '../domain/commerce-vertical.errors';
import type { CustomerCommerceVerticalView } from '../domain/commerce-vertical.types';
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
  DeliveryCoverage,
} from '../domain/customer-catalog.types';
import { CommerceVerticalRepository } from '../infrastructure/commerce-vertical.repository';
import { CustomerCatalogRepository } from '../infrastructure/customer-catalog.repository';

@Injectable()
export class CustomerCatalogService {
  constructor(
    private readonly catalog: CustomerCatalogRepository,
    private readonly openingHours: OpeningHoursService,
    @Inject(CHECKOUT_CLOCK) private readonly clock: CheckoutClock,
    private readonly verticals: CommerceVerticalRepository,
    private readonly covers: MerchantBranchCoverService,
    private readonly productImages: MerchantProductImageService,
    private readonly geo: GeoService,
  ) {}

  async listCommerceVerticals(
    accountId: string,
  ): Promise<{ items: CustomerCommerceVerticalView[] }> {
    await this.requireCustomerProfile(accountId);
    const rows = await this.verticals.listActive();
    return {
      items: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        iconKey: row.iconKey,
        sortOrder: row.sortOrder,
      })),
    };
  }

  async listStorefronts(
    accountId: string,
    query: {
      limit?: number;
      offset?: number;
      sort?: string;
      verticalId?: string;
      openNow?: boolean;
      addressId?: string;
      wilayaCode?: string;
    },
  ): Promise<CustomerCatalogPage<CustomerStorefrontSummary>> {
    const profileId = await this.requireCustomerProfile(accountId);
    resolveCustomerCatalogSort(query.sort);
    const page = normalizeCustomerCatalogPagination(query);
    if (query.verticalId) {
      const vertical = await this.verticals.findById(query.verticalId);
      if (!vertical) {
        throw commerceVerticalNotFound();
      }
      if (!vertical.active) {
        throw commerceVerticalInactive();
      }
    }
    if (query.wilayaCode) {
      await this.geo.listCommunes(query.wilayaCode);
    }
    let coverage: DeliveryCoverage = {
      inCoverage: true,
      zoneCount: 0,
      reason: 'UNFILTERED',
    };
    let coverageZoneId: string | undefined;
    if (query.addressId) {
      const address = await this.catalog.findOwnedAddress(
        profileId,
        query.addressId,
      );
      if (!address) {
        throw customerAddressNotFound();
      }
      if (!hasValidCoordinates(address.latitude, address.longitude)) {
        coverage = { inCoverage: false, zoneCount: 0, reason: 'OUTSIDE' };
        return {
          items: [],
          limit: page.limit,
          offset: page.offset,
          total: 0,
          coverage,
        };
      }
      const zones = await this.catalog.findCoveringZones(
        address.latitude,
        address.longitude,
      );
      if (zones.length === 0) {
        return {
          items: [],
          limit: page.limit,
          offset: page.offset,
          total: 0,
          coverage: { inCoverage: false, zoneCount: 0, reason: 'OUTSIDE' },
        };
      }
      if (zones.length > 1) {
        return {
          items: [],
          limit: page.limit,
          offset: page.offset,
          total: 0,
          coverage: {
            inCoverage: false,
            zoneCount: zones.length,
            reason: 'AMBIGUOUS',
          },
        };
      }
      coverageZoneId = zones[0].id;
      coverage = { inCoverage: true, zoneCount: 1, reason: 'INSIDE' };
    }
    // One captured "now" for openNow SQL filter + hours enrichment so totals agree.
    const now = this.clock.now();
    const openNowLocal =
      query.openNow === true ? captureOpenNowLocalParts(now) : undefined;
    const result = await this.catalog.listStorefronts({
      ...page,
      verticalId: query.verticalId,
      openNowLocal,
      coverageZoneId,
      wilayaCode: query.wilayaCode,
    });
    const hours = await this.openingHours.evaluateBranches(
      result.items.map((item) => item.branchId),
      now,
    );
    return {
      ...result,
      coverage,
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

  async readCover(
    accountId: string,
    branchId: string,
  ): Promise<{ body: Buffer; contentType: string }> {
    await this.requireCustomerProfile(accountId);
    const storefront = await this.catalog.findVisibleStorefront(branchId);
    if (!storefront) {
      throw customerStorefrontNotFound();
    }
    return this.covers.readCustomerCover(branchId);
  }

  async readProductImage(
    accountId: string,
    branchId: string,
    productId: string,
  ): Promise<{ body: Buffer; contentType: string }> {
    await this.requireCustomerProfile(accountId);
    const product = await this.catalog.findVisibleProductDetail(
      branchId,
      productId,
    );
    if (!product) {
      throw customerProductNotFound();
    }
    return this.productImages.readCustomerImage(productId);
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
      coverImageUrl: storefront.coverImageUrl ?? null,
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
