import { Injectable } from '@nestjs/common';
import { ProductImageStorageService } from '../../../infrastructure/storage/application/product-image-storage.service';
import { customerProductImagePath } from '../../../infrastructure/storage/domain/product-image.policy';
import { storageObjectMissing } from '../../../infrastructure/storage/domain/storage.errors';
import { MerchantAccessService } from '../../merchants/application/merchant-access.service';
import { MERCHANT_CAPABILITIES } from '../../merchants/domain/merchant.policy';
import { MerchantRepository } from '../../merchants/infrastructure/merchant.repository';
import { catalogProductNotFound } from '../domain/catalog.errors';
import { CatalogRepository } from '../infrastructure/catalog.repository';
import { ProductImageRepository } from '../infrastructure/product-image.repository';

@Injectable()
export class MerchantProductImageService {
  constructor(
    private readonly access: MerchantAccessService,
    private readonly merchants: MerchantRepository,
    private readonly catalog: CatalogRepository,
    private readonly images: ProductImageRepository,
    private readonly media: ProductImageStorageService,
  ) {}

  async uploadContent(
    accountId: string,
    merchantId: string,
    branchId: string,
    productId: string,
    input: {
      body: Buffer;
      declaredMime?: string;
      originalFilename?: string;
    },
  ) {
    await this.requireOwnedProduct(accountId, merchantId, branchId, productId);
    return this.media.uploadPending(
      { accountId, merchantId, branchId, productId },
      input,
    );
  }

  async bind(
    accountId: string,
    merchantId: string,
    branchId: string,
    productId: string,
    uploadReference: string,
  ) {
    await this.requireOwnedProduct(accountId, merchantId, branchId, productId);
    const promoted = await this.media.promotePending({
      uploadReference,
      accountId,
      merchantId,
      branchId,
      productId,
    });
    try {
      const { previous, current } = await this.images.upsert({
        productId,
        objectId: promoted.objectId,
        contentType: promoted.contentType,
        byteSize: promoted.byteSize,
        widthPx: promoted.widthPx,
        heightPx: promoted.heightPx,
      });
      await this.deleteUnreferencedImage(previous?.objectId, current.objectId);
      return {
        productId,
        branchId,
        imageUrl: customerProductImagePath(branchId, productId),
        contentType: current.contentType,
        widthPx: current.widthPx,
        heightPx: current.heightPx,
      };
    } catch (error) {
      await this.deleteUnreferencedImage(promoted.objectId);
      throw error;
    }
  }

  async remove(
    accountId: string,
    merchantId: string,
    branchId: string,
    productId: string,
  ) {
    await this.requireOwnedProduct(accountId, merchantId, branchId, productId);
    const removed = await this.images.deleteByProduct(productId);
    if (removed) {
      await this.deleteUnreferencedImage(removed.objectId);
    }
    return { deleted: true as const };
  }

  async readForMerchant(
    accountId: string,
    merchantId: string,
    branchId: string,
    productId: string,
  ): Promise<{
    body: Buffer;
    contentType: string;
  }> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.CATALOG_READ,
    );
    const product = await this.catalog.findProduct(productId);
    if (!product || product.merchantBranchId !== branchId) {
      throw catalogProductNotFound();
    }
    const branch = await this.merchants.findOwnedBranch(merchantId, branchId);
    if (!branch) {
      throw catalogProductNotFound();
    }
    return this.readCustomerImage(productId);
  }

  async readCustomerImage(productId: string): Promise<{
    body: Buffer;
    contentType: string;
  }> {
    const image = await this.images.findByProduct(productId);
    if (!image) {
      throw storageObjectMissing();
    }
    const stored = await this.media.readImage(image.objectId);
    return { body: stored.body, contentType: image.contentType };
  }

  async deleteUnreferencedImage(
    objectId?: string,
    keepObjectId?: string,
  ): Promise<void> {
    if (!objectId || objectId === keepObjectId) {
      return;
    }
    const referenced = await this.images.findByObjectId(objectId);
    if (referenced) {
      return;
    }
    await this.media.deleteImage(objectId);
  }

  private async requireOwnedProduct(
    accountId: string,
    merchantId: string,
    branchId: string,
    productId: string,
  ): Promise<void> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.PRODUCT_MANAGE,
    );
    const product = await this.catalog.findProduct(productId);
    if (!product || product.merchantBranchId !== branchId) {
      throw catalogProductNotFound();
    }
    const branch = await this.merchants.findOwnedBranch(merchantId, branchId);
    if (!branch) {
      throw catalogProductNotFound();
    }
  }
}
