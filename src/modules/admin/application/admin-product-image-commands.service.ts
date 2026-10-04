import { Injectable } from '@nestjs/common';
import { ProductImageStorageService } from '../../../infrastructure/storage/application/product-image-storage.service';
import { customerProductImagePath } from '../../../infrastructure/storage/domain/product-image.policy';
import { PrismaService } from '../../../infrastructure/database/database.module';
import { catalogProductNotFound } from '../../catalog/domain/catalog.errors';
import { CatalogRepository } from '../../catalog/infrastructure/catalog.repository';
import { ProductImageRepository } from '../../catalog/infrastructure/product-image.repository';
import { MerchantRepository } from '../../merchants/infrastructure/merchant.repository';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
} from '../domain/admin-audit-actions';
import type { CurrentAdminContext } from '../domain/admin.types';
import { AdminAuditService, type OrmClient } from './admin-audit.service';

@Injectable()
export class AdminProductImageCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogRepository,
    private readonly merchants: MerchantRepository,
    private readonly images: ProductImageRepository,
    private readonly media: ProductImageStorageService,
    private readonly audit: AdminAuditService,
  ) {}

  async uploadContent(
    admin: CurrentAdminContext,
    productId: string,
    input: {
      body: Buffer;
      declaredMime?: string;
      originalFilename?: string;
    },
  ) {
    const owned = await this.requireProduct(productId);
    return this.media.uploadPending(
      {
        accountId: admin.accountId,
        merchantId: owned.merchantId,
        branchId: owned.branchId,
        productId,
      },
      input,
    );
  }

  async bind(
    admin: CurrentAdminContext,
    productId: string,
    uploadReference: string,
  ) {
    const owned = await this.requireProduct(productId);
    const promoted = await this.media.promotePending({
      uploadReference,
      accountId: admin.accountId,
      merchantId: owned.merchantId,
      branchId: owned.branchId,
      productId,
    });
    try {
      const bound = await this.prisma.getDb().transaction(async (tx: OrmClient) => {
        const live = await this.requireProduct(productId);
        const { previous, current } = await this.images.upsert(
          {
            productId,
            objectId: promoted.objectId,
            contentType: promoted.contentType,
            byteSize: promoted.byteSize,
            widthPx: promoted.widthPx,
            heightPx: promoted.heightPx,
          },
          tx,
        );
        await this.audit.recordInTx(tx, {
          adminId: admin.adminProfileId,
          action: ADMIN_AUDIT_ACTIONS.PRODUCT_IMAGE_BIND,
          targetType: ADMIN_AUDIT_TARGET_TYPES.PRODUCT,
          targetId: productId,
          beforeJson: previous,
          afterJson: current,
          sessionId: admin.sessionId,
        });
        return { previous, current, branchId: live.branchId };
      });
      await this.deleteUnreferencedImage(
        bound.previous?.objectId,
        bound.current.objectId,
      );
      return {
        productId,
        branchId: bound.branchId,
        imageUrl: customerProductImagePath(bound.branchId, productId),
        contentType: bound.current.contentType,
        widthPx: bound.current.widthPx,
        heightPx: bound.current.heightPx,
      };
    } catch (error) {
      await this.deleteUnreferencedImage(promoted.objectId);
      throw error;
    }
  }

  async remove(admin: CurrentAdminContext, productId: string) {
    await this.requireProduct(productId);
    const removed = await this.prisma.getDb().transaction(async (tx: OrmClient) => {
      const row = await this.images.deleteByProduct(productId, tx);
      if (row) {
        await this.audit.recordInTx(tx, {
          adminId: admin.adminProfileId,
          action: ADMIN_AUDIT_ACTIONS.PRODUCT_IMAGE_DELETE,
          targetType: ADMIN_AUDIT_TARGET_TYPES.PRODUCT,
          targetId: productId,
          beforeJson: row,
          sessionId: admin.sessionId,
        });
      }
      return row;
    });
    if (removed) {
      await this.deleteUnreferencedImage(removed.objectId);
    }
    return { deleted: true as const };
  }

  private async requireProduct(productId: string) {
    const product = await this.catalog.findProduct(productId);
    if (!product) {
      throw catalogProductNotFound();
    }
    const branch = await this.merchants.findBranchById(product.merchantBranchId);
    if (!branch) {
      throw catalogProductNotFound();
    }
    return { branchId: product.merchantBranchId, merchantId: branch.merchantId };
  }

  private async deleteUnreferencedImage(
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
}
