import { Injectable } from '@nestjs/common';
import { CoverMediaStorageService } from '../../../infrastructure/storage/application/cover-media-storage.service';
import { customerCoverImagePath } from '../../../infrastructure/storage/domain/cover-media.policy';
import { storageObjectMissing } from '../../../infrastructure/storage/domain/storage.errors';
import { MERCHANT_CAPABILITIES } from '../domain/merchant.policy';
import { merchantBranchNotFound } from '../domain/merchant.errors';
import { MerchantBranchCoverRepository } from '../infrastructure/merchant-branch-cover.repository';
import { MerchantRepository } from '../infrastructure/merchant.repository';
import { MerchantAccessService } from './merchant-access.service';

@Injectable()
export class MerchantBranchCoverService {
  constructor(
    private readonly access: MerchantAccessService,
    private readonly merchants: MerchantRepository,
    private readonly covers: MerchantBranchCoverRepository,
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
    await this.requireCoverCapability(accountId, merchantId, branchId);
    return this.media.uploadPending({ accountId, merchantId, branchId }, input);
  }

  async bind(
    accountId: string,
    merchantId: string,
    branchId: string,
    uploadReference: string,
  ) {
    await this.requireCoverCapability(accountId, merchantId, branchId);
    const promoted = await this.media.promotePending({
      uploadReference,
      accountId,
      merchantId,
      branchId,
    });
    try {
      const { previous, current } = await this.covers.upsert({
        branchId,
        objectId: promoted.objectId,
        contentType: promoted.contentType,
        byteSize: promoted.byteSize,
        widthPx: promoted.widthPx,
        heightPx: promoted.heightPx,
      });
      await this.deleteUnreferencedCover(previous?.objectId, current.objectId);
      return {
        branchId,
        coverImageUrl: customerCoverImagePath(branchId),
        contentType: current.contentType,
        widthPx: current.widthPx,
        heightPx: current.heightPx,
      };
    } catch (error) {
      await this.deleteUnreferencedCover(promoted.objectId);
      throw error;
    }
  }

  async remove(accountId: string, merchantId: string, branchId: string) {
    await this.requireCoverCapability(accountId, merchantId, branchId);
    const removed = await this.covers.deleteByBranch(branchId);
    if (removed) {
      await this.deleteUnreferencedCover(removed.objectId);
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
    return this.readCustomerCover(branchId);
  }

  async readCustomerCover(branchId: string): Promise<{
    body: Buffer;
    contentType: string;
  }> {
    const cover = await this.covers.findByBranch(branchId);
    if (!cover) {
      throw storageObjectMissing();
    }
    const stored = await this.media.readCover(cover.objectId);
    return { body: stored.body, contentType: cover.contentType };
  }

  private async deleteUnreferencedCover(
    objectId?: string,
    keepObjectId?: string,
  ): Promise<void> {
    if (!objectId || objectId === keepObjectId) {
      return;
    }
    const referenced = await this.covers.findByObjectId(objectId);
    if (referenced) {
      return;
    }
    await this.media.deleteCover(objectId);
  }

  private async requireCoverCapability(
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
