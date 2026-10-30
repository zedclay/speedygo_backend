import { Injectable } from '@nestjs/common';
import { customerProfileNotFound } from '../../customers/domain/customer.errors';
import {
  customerProductNotFound,
  customerStorefrontNotFound,
} from '../domain/customer-catalog.errors';
import type { PinCoverageResolution } from '../domain/customer-catalog.policy';
import type {
  CustomerProductSummary,
  CustomerStorefrontSummary,
} from '../domain/customer-catalog.types';
import { customerFavoriteKindInvalid } from '../domain/customer-favorites.errors';
import {
  CUSTOMER_FAVORITE_KIND_BRANCH,
  CUSTOMER_FAVORITE_KIND_PRODUCT,
  type CustomerFavoriteKind,
} from '../domain/customer-favorites.types';
import { CustomerCatalogRepository } from '../infrastructure/customer-catalog.repository';
import { CustomerFavoritesRepository } from '../infrastructure/customer-favorites.repository';
import { CustomerCatalogService } from './customer-catalog.service';

@Injectable()
export class CustomerFavoritesService {
  constructor(
    private readonly favorites: CustomerFavoritesRepository,
    private readonly catalog: CustomerCatalogRepository,
    private readonly discovery: CustomerCatalogService,
  ) {}

  async list(
    accountId: string,
    kindRaw?: string,
    addressId?: string,
  ): Promise<{
    kind: CustomerFavoriteKind;
    branches: CustomerStorefrontSummary[];
    products: Array<{
      product: CustomerProductSummary;
      storefront: CustomerStorefrontSummary;
    }>;
  }> {
    const profileId = await this.requireProfile(accountId);
    const kind = this.parseKind(kindRaw) ?? CUSTOMER_FAVORITE_KIND_BRANCH;
    const pin = await this.discovery.resolveOwnedPinCoverage(
      accountId,
      addressId,
    );
    const rows = await this.favorites.listOwned({ customerId: profileId, kind });
    if (kind === CUSTOMER_FAVORITE_KIND_BRANCH) {
      const branches: CustomerStorefrontSummary[] = [];
      for (const row of rows) {
        try {
          const storefront = await this.discovery.getStorefront(
            accountId,
            row.branchId,
          );
          branches.push(await this.withPinCoverage(storefront, pin));
        } catch {
          // Stale/deleted/hidden: omit, do not fail the list.
        }
      }
      return { kind, branches, products: [] };
    }
    const products: Array<{
      product: CustomerProductSummary;
      storefront: CustomerStorefrontSummary;
    }> = [];
    for (const row of rows) {
      try {
        const detail = await this.discovery.getProduct(
          accountId,
          row.branchId,
          row.targetId,
        );
        const storefront = await this.discovery.getStorefront(
          accountId,
          row.branchId,
        );
        products.push({
          product: {
            productId: detail.productId,
            branchId: detail.branchId,
            categoryId: detail.categoryId,
            name: detail.name,
            description: detail.description,
            priceMinor: detail.priceMinor,
            imageUrl: detail.imageUrl,
          },
          storefront: await this.withPinCoverage(storefront, pin),
        });
      } catch {
        // Stale/deleted/hidden: omit.
      }
    }
    return { kind, branches: [], products };
  }

  async listIds(accountId: string): Promise<{
    branchIds: string[];
    productIds: string[];
  }> {
    const profileId = await this.requireProfile(accountId);
    return this.favorites.listOwnedIds(profileId);
  }

  async addBranch(accountId: string, branchId: string): Promise<{ ok: true }> {
    const profileId = await this.requireProfile(accountId);
    const visible = await this.favorites.findVisibleBranchId(branchId);
    if (!visible) {
      throw customerStorefrontNotFound();
    }
    await this.favorites.insert({
      customerId: profileId,
      targetKind: CUSTOMER_FAVORITE_KIND_BRANCH,
      targetId: branchId,
      branchId,
    });
    return { ok: true };
  }

  async removeBranch(
    accountId: string,
    branchId: string,
  ): Promise<{ ok: true }> {
    const profileId = await this.requireProfile(accountId);
    await this.favorites.deleteOwned({
      customerId: profileId,
      targetKind: CUSTOMER_FAVORITE_KIND_BRANCH,
      targetId: branchId,
    });
    return { ok: true };
  }

  async addProduct(
    accountId: string,
    productId: string,
  ): Promise<{ ok: true }> {
    const profileId = await this.requireProfile(accountId);
    const visible = await this.favorites.findVisibleProduct({ productId });
    if (!visible) {
      throw customerProductNotFound();
    }
    await this.favorites.insert({
      customerId: profileId,
      targetKind: CUSTOMER_FAVORITE_KIND_PRODUCT,
      targetId: productId,
      branchId: visible.branchId,
    });
    return { ok: true };
  }

  async removeProduct(
    accountId: string,
    productId: string,
  ): Promise<{ ok: true }> {
    const profileId = await this.requireProfile(accountId);
    await this.favorites.deleteOwned({
      customerId: profileId,
      targetKind: CUSTOMER_FAVORITE_KIND_PRODUCT,
      targetId: productId,
    });
    return { ok: true };
  }

  private async withPinCoverage(
    storefront: CustomerStorefrontSummary,
    pin: PinCoverageResolution,
  ): Promise<CustomerStorefrontSummary> {
    const coverage = await this.discovery.coverageForStorefront(storefront, pin);
    return { ...storefront, coverage };
  }

  private parseKind(raw?: string): CustomerFavoriteKind | undefined {
    if (raw === undefined || raw === '') {
      return undefined;
    }
    if (
      raw === CUSTOMER_FAVORITE_KIND_BRANCH ||
      raw === CUSTOMER_FAVORITE_KIND_PRODUCT
    ) {
      return raw;
    }
    throw customerFavoriteKindInvalid();
  }

  private async requireProfile(accountId: string): Promise<string> {
    const profileId = await this.catalog.findProfileIdByAccountId(accountId);
    if (!profileId) {
      throw customerProfileNotFound();
    }
    return profileId;
  }
}
