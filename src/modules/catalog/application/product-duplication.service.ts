import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ProductImageStorageService } from '../../../infrastructure/storage/application/product-image-storage.service';
import { MerchantAccessService } from '../../merchants/application/merchant-access.service';
import { MERCHANT_CAPABILITIES } from '../../merchants/domain/merchant.policy';
import { MerchantRepository } from '../../merchants/infrastructure/merchant.repository';
import {
  catalogDuplicateRequestConflict,
  catalogProductNotFound,
} from '../domain/catalog.errors';
import type { ProductDetailView } from '../domain/catalog.types';
import { CatalogRepository } from '../infrastructure/catalog.repository';
import {
  ProductDuplicationRepository,
  type DuplicatedImage,
} from '../infrastructure/product-duplication.repository';
import { ProductImageRepository } from '../infrastructure/product-image.repository';
import { CatalogService } from './catalog.service';
import { MerchantProductImageService } from './merchant-product-image.service';

export const PRODUCT_NAME_MAX = 255;
export const DUPLICATE_NAME_PREFIX = 'Copie de ';

export type ProductDuplicationResult = {
  product: ProductDetailView;
  replayed: boolean;
  copied: {
    optionGroupCount: number;
    optionCount: number;
    imageCopied: boolean;
  };
};

/** Deterministic default French name, truncated by code point to the column limit. */
export function defaultDuplicateName(sourceName: string): string {
  return Array.from(`${DUPLICATE_NAME_PREFIX}${sourceName}`)
    .slice(0, PRODUCT_NAME_MAX)
    .join('');
}

export function duplicateRequestKey(
  sourceProductId: string,
  requestId: string,
): string {
  return createHash('sha256')
    .update(`${sourceProductId}:${requestId.toLowerCase()}`)
    .digest('hex');
}

@Injectable()
export class ProductDuplicationService {
  constructor(
    private readonly access: MerchantAccessService,
    private readonly merchants: MerchantRepository,
    private readonly catalog: CatalogRepository,
    private readonly duplication: ProductDuplicationRepository,
    private readonly images: ProductImageRepository,
    private readonly imageStorage: ProductImageStorageService,
    private readonly productImages: MerchantProductImageService,
    private readonly catalogService: CatalogService,
  ) {}

  async duplicate(
    accountId: string,
    merchantId: string,
    sourceProductId: string,
    input: { requestId: string; name?: string | null },
  ): Promise<ProductDuplicationResult> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.PRODUCT_MANAGE,
    );
    const source = await this.catalog.findProduct(sourceProductId);
    if (!source) {
      throw catalogProductNotFound();
    }
    const branch = await this.merchants.findOwnedBranch(
      merchantId,
      source.merchantBranchId,
    );
    if (!branch) {
      throw catalogProductNotFound();
    }

    const requestKey = duplicateRequestKey(source.id, input.requestId);
    const existing = await this.duplication.findByRequestKey(requestKey);
    if (existing) {
      return this.replay(
        accountId,
        merchantId,
        existing,
        source.merchantBranchId,
      );
    }

    const name = this.resolveName(input.name, source.name);
    const sourceImage = await this.images.findByProduct(source.id);
    let copiedImage: DuplicatedImage | null = null;
    if (sourceImage) {
      copiedImage = await this.imageStorage.copyImage(sourceImage.objectId);
    }

    let outcome;
    try {
      outcome = await this.duplication.duplicate({
        sourceProductId: source.id,
        requestKey,
        name,
        image: copiedImage,
      });
    } catch (error) {
      await this.discardCopiedImage(copiedImage);
      throw error;
    }

    if (outcome.status !== 'created') {
      await this.discardCopiedImage(copiedImage);
      if (outcome.status === 'source_missing') {
        throw catalogProductNotFound();
      }
      const winner = await this.duplication.findByRequestKey(requestKey);
      if (!winner) {
        throw catalogDuplicateRequestConflict();
      }
      return this.replay(
        accountId,
        merchantId,
        winner,
        source.merchantBranchId,
      );
    }

    const product = await this.catalogService.getProduct(
      accountId,
      merchantId,
      outcome.productId,
    );
    return {
      product,
      replayed: false,
      copied: {
        optionGroupCount: outcome.optionGroupCount,
        optionCount: outcome.optionCount,
        imageCopied: outcome.imageCopied,
      },
    };
  }

  private async replay(
    accountId: string,
    merchantId: string,
    existing: { id: string; merchantBranchId: string },
    sourceBranchId: string,
  ): Promise<ProductDuplicationResult> {
    if (existing.merchantBranchId !== sourceBranchId) {
      throw catalogDuplicateRequestConflict();
    }
    const product = await this.catalogService.getProduct(
      accountId,
      merchantId,
      existing.id,
    );
    const copied = await this.duplication.countCopiedConfiguration(existing.id);
    return { product, replayed: true, copied };
  }

  private resolveName(
    name: string | null | undefined,
    sourceName: string,
  ): string {
    if (name === undefined || name === null) {
      return defaultDuplicateName(sourceName);
    }
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return defaultDuplicateName(sourceName);
    }
    return Array.from(trimmed).slice(0, PRODUCT_NAME_MAX).join('');
  }

  private async discardCopiedImage(
    image: DuplicatedImage | null,
  ): Promise<void> {
    if (!image) {
      return;
    }
    await this.productImages
      .deleteUnreferencedImage(image.objectId)
      .catch(() => undefined);
  }
}
