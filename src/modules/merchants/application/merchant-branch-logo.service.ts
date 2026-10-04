import { Injectable } from '@nestjs/common';
import { CoverMediaStorageService } from '../../../infrastructure/storage/application/cover-media-storage.service';
import { merchantLogoImagePath } from '../../../infrastructure/storage/domain/cover-media.policy';
import { storageObjectMissing } from '../../../infrastructure/storage/domain/storage.errors';
import { MERCHANT_CAPABILITIES } from '../domain/merchant.policy';
import { merchantBranchNotFound } from '../domain/merchant.errors';
import { MerchantBranchLogoRepository } from '../infrastructure/merchant-branch-logo.repository';
import { MerchantRepository } from '../infrastructure/merchant.repository';
import { MerchantAccessService } from './merchant-access.service';

/**
 * Branch-scoped store logo. Reuses the branch media pipeline (pending token →
 * promote → bind) with purpose MERCHANT_BRANCH_LOGO and the logos/ namespace.
 */
@Injectable()
export class MerchantBranchLogoService {
  constructor(
    private readonly access: MerchantAccessService,
    private readonly merchants: MerchantRepository,
    private readonly logos: MerchantBranchLogoRepository,
    private readonly media: CoverMediaStorageService,
  ) {}

  async uploadContent(
    accountId: string,
    merchantId: string,
    branchId: string,
    input: {
      body: Buffer;
      declaredMime?: string;
      originalFilename?: string;
    },
  ) {
    await this.requireMutateCapability(accountId, merchantId, branchId);
    return this.media.uploadPendingLogo(
      { accountId, merchantId, branchId },
      input,
    );
  }

  async bind(
    accountId: string,
    merchantId: string,
    branchId: string,
    uploadReference: string,
  ) {
    await this.requireMutateCapability(accountId, merchantId, branchId);
    const promoted = await this.media.promotePendingLogo({
      uploadReference,
      accountId,
      merchantId,
      branchId,
    });
    try {
      const { previous, current } = await this.logos.upsert({
        branchId,
        objectId: promoted.objectId,
        contentType: promoted.contentType,
        byteSize: promoted.byteSize,
        widthPx: promoted.widthPx,
        heightPx: promoted.heightPx,
      });
      await this.deleteUnreferencedLogo(previous?.objectId, current.objectId);
      return {
        branchId,
        logoImageUrl: merchantLogoImagePath(merchantId, branchId),
        logoVersion: current.objectId,
        contentType: current.contentType,
        widthPx: current.widthPx,
        heightPx: current.heightPx,
      };
    } catch (error) {
      await this.deleteUnreferencedLogo(promoted.objectId);
      throw error;
    }
  }

  async remove(accountId: string, merchantId: string, branchId: string) {
    await this.requireMutateCapability(accountId, merchantId, branchId);
    const removed = await this.logos.deleteByBranch(branchId);
    if (removed) {
      await this.deleteUnreferencedLogo(removed.objectId);
    }
    return { deleted: true as const };
  }

  async readForMerchant(
    accountId: string,
    merchantId: string,
    branchId: string,
  ): Promise<{
    body: Buffer;
    contentType: string;
    version: string;
  }> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.MERCHANT_READ,
    );
    const branch = await this.merchants.findOwnedBranch(merchantId, branchId);
    if (!branch) {
      throw merchantBranchNotFound();
    }
    const logo = await this.logos.findByBranch(branchId);
    if (!logo) {
      throw storageObjectMissing();
    }
    const stored = await this.media.readLogo(logo.objectId);
    return {
      body: stored.body,
      contentType: logo.contentType,
      version: logo.objectId,
    };
  }

  private async deleteUnreferencedLogo(
    objectId?: string,
    keepObjectId?: string,
  ): Promise<void> {
    if (!objectId || objectId === keepObjectId) {
      return;
    }
    const referenced = await this.logos.findByObjectId(objectId);
    if (referenced) {
      return;
    }
    await this.media.deleteLogo(objectId);
  }

  private async requireMutateCapability(
    accountId: string,
    merchantId: string,
    branchId: string,
  ): Promise<void> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.MERCHANT_BRANCH_UPDATE,
    );
    const branch = await this.merchants.findOwnedBranch(merchantId, branchId);
    if (!branch) {
      throw merchantBranchNotFound();
    }
  }
}
