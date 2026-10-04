import { Injectable } from '@nestjs/common';
import { CoverMediaStorageService } from '../../../infrastructure/storage/application/cover-media-storage.service';
import { customerCoverImagePath } from '../../../infrastructure/storage/domain/cover-media.policy';
import { PrismaService } from '../../../infrastructure/database/database.module';
import { merchantBranchNotFound } from '../../merchants/domain/merchant.errors';
import { MerchantBranchCoverRepository } from '../../merchants/infrastructure/merchant-branch-cover.repository';
import { MerchantRepository } from '../../merchants/infrastructure/merchant.repository';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
} from '../domain/admin-audit-actions';
import type { CurrentAdminContext } from '../domain/admin.types';
import { AdminAuditService, type OrmClient } from './admin-audit.service';

@Injectable()
export class AdminStorefrontCoverCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly merchants: MerchantRepository,
    private readonly covers: MerchantBranchCoverRepository,
    private readonly media: CoverMediaStorageService,
    private readonly audit: AdminAuditService,
  ) {}

  async uploadContent(
    admin: CurrentAdminContext,
    branchId: string,
    input: {
      body: Buffer;
      declaredMime?: string;
      originalFilename?: string;
    },
  ) {
    const branch = await this.merchants.findBranchById(branchId);
    if (!branch) {
      throw merchantBranchNotFound();
    }
    return this.media.uploadPending(
      {
        accountId: admin.accountId,
        merchantId: branch.merchantId,
        branchId,
      },
      input,
    );
  }

  async bind(
    admin: CurrentAdminContext,
    branchId: string,
    uploadReference: string,
  ) {
    const branch = await this.merchants.findBranchById(branchId);
    if (!branch) {
      throw merchantBranchNotFound();
    }
    const promoted = await this.media.promotePending({
      uploadReference,
      accountId: admin.accountId,
      merchantId: branch.merchantId,
      branchId,
    });
    try {
      const bound = await this.prisma.getDb().transaction(async (tx: OrmClient) => {
        const live = await this.merchants.findBranchById(branchId, tx);
        if (!live) {
          throw merchantBranchNotFound();
        }
        const { previous, current } = await this.covers.upsert(
          {
            branchId,
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
          action: ADMIN_AUDIT_ACTIONS.STOREFRONT_COVER_BIND,
          targetType: ADMIN_AUDIT_TARGET_TYPES.MERCHANT_BRANCH,
          targetId: branchId,
          beforeJson: previous,
          afterJson: current,
          sessionId: admin.sessionId,
        });
        return { previous, current };
      });
      await this.deleteUnreferencedCover(
        bound.previous?.objectId,
        bound.current.objectId,
      );
      return {
        branchId,
        coverImageUrl: customerCoverImagePath(branchId),
        contentType: bound.current.contentType,
        widthPx: bound.current.widthPx,
        heightPx: bound.current.heightPx,
      };
    } catch (error) {
      await this.deleteUnreferencedCover(promoted.objectId);
      throw error;
    }
  }

  async remove(admin: CurrentAdminContext, branchId: string) {
    const removed = await this.prisma.getDb().transaction(async (tx: OrmClient) => {
      const row = await this.covers.deleteByBranch(branchId, tx);
      if (row) {
        await this.audit.recordInTx(tx, {
          adminId: admin.adminProfileId,
          action: ADMIN_AUDIT_ACTIONS.STOREFRONT_COVER_DELETE,
          targetType: ADMIN_AUDIT_TARGET_TYPES.MERCHANT_BRANCH,
          targetId: branchId,
          beforeJson: row,
          sessionId: admin.sessionId,
        });
      }
      return row;
    });
    if (removed) {
      await this.deleteUnreferencedCover(removed.objectId);
    }
    return { deleted: true as const };
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
}
