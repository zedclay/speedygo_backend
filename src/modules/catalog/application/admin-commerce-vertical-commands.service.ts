import { Injectable } from '@nestjs/common';
import { isPostgresUniqueViolation } from '../../../common/errors/postgres-unique';
import { PrismaService } from '../../../infrastructure/database/database.module';
import {
  AdminAuditService,
  type OrmClient,
} from '../../admin/application/admin-audit.service';
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
} from '../../admin/domain/admin-audit-actions';
import type { CurrentAdminContext } from '../../admin/domain/admin.types';
import { merchantBranchNotFound } from '../../merchants/domain/merchant.errors';
import { MerchantRepository } from '../../merchants/infrastructure/merchant.repository';
import {
  commerceVerticalInactive,
  commerceVerticalInvalid,
  commerceVerticalNotFound,
  commerceVerticalSlugConflict,
  merchantBranchClassificationNotFound,
} from '../domain/commerce-vertical.errors';
import {
  isCommerceVerticalIconKey,
  normalizeCommerceVerticalName,
  normalizeCommerceVerticalSlug,
} from '../domain/commerce-vertical.policy';
import type { CommerceVerticalRecord } from '../domain/commerce-vertical.types';
import { CommerceVerticalRepository } from '../infrastructure/commerce-vertical.repository';

@Injectable()
export class AdminCommerceVerticalCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly verticals: CommerceVerticalRepository,
    private readonly merchants: MerchantRepository,
    private readonly audit: AdminAuditService,
  ) {}

  list() {
    return this.verticals.listAll();
  }

  async getClassification(branchId: string) {
    const branch = await this.merchants.findBranchById(branchId);
    if (!branch) {
      throw merchantBranchNotFound();
    }
    const assigned = await this.verticals.findClassificationByBranch(branchId);
    return assigned ?? { branchId, verticalId: null as string | null };
  }

  async create(
    admin: CurrentAdminContext,
    input: { slug: string; name: string; iconKey: string; sortOrder: number },
  ): Promise<CommerceVerticalRecord> {
    const slug = normalizeCommerceVerticalSlug(input.slug);
    const name = normalizeCommerceVerticalName(input.name);
    if (!slug) {
      throw commerceVerticalInvalid('slug is invalid');
    }
    if (!name) {
      throw commerceVerticalInvalid('name is invalid');
    }
    if (!isCommerceVerticalIconKey(input.iconKey)) {
      throw commerceVerticalInvalid('iconKey is not allowlisted');
    }
    if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0) {
      throw commerceVerticalInvalid('sortOrder must be a non-negative integer');
    }
    try {
      return await this.prisma.getDb().transaction(async (tx: OrmClient) => {
        const created = await this.verticals.create(
          {
            slug,
            name,
            iconKey: input.iconKey,
            sortOrder: input.sortOrder,
            active: true,
          },
          tx,
        );
        await this.audit.recordInTx(tx, {
          adminId: admin.adminProfileId,
          action: ADMIN_AUDIT_ACTIONS.COMMERCE_VERTICAL_CREATE,
          targetType: ADMIN_AUDIT_TARGET_TYPES.COMMERCE_VERTICAL,
          targetId: created.id,
          afterJson: created,
          sessionId: admin.sessionId,
        });
        return created;
      });
    } catch (error) {
      if (isPostgresUniqueViolation(error)) {
        throw commerceVerticalSlugConflict();
      }
      throw error;
    }
  }

  async update(
    admin: CurrentAdminContext,
    id: string,
    patch: { name?: string; iconKey?: string; sortOrder?: number },
  ): Promise<CommerceVerticalRecord> {
    return this.prisma.getDb().transaction(async (tx: OrmClient) => {
      const before = await this.verticals.findById(id, tx);
      if (!before) {
        throw commerceVerticalNotFound();
      }
      const nextName =
        patch.name !== undefined
          ? normalizeCommerceVerticalName(patch.name)
          : before.name;
      if (patch.name !== undefined && !nextName) {
        throw commerceVerticalInvalid('name is invalid');
      }
      if (
        patch.iconKey !== undefined &&
        !isCommerceVerticalIconKey(patch.iconKey)
      ) {
        throw commerceVerticalInvalid('iconKey is not allowlisted');
      }
      if (
        patch.sortOrder !== undefined &&
        (!Number.isInteger(patch.sortOrder) || patch.sortOrder < 0)
      ) {
        throw commerceVerticalInvalid(
          'sortOrder must be a non-negative integer',
        );
      }
      const unchanged =
        (patch.name === undefined || nextName === before.name) &&
        (patch.iconKey === undefined || patch.iconKey === before.iconKey) &&
        (patch.sortOrder === undefined || patch.sortOrder === before.sortOrder);
      if (unchanged) {
        return before;
      }
      const after = await this.verticals.update(
        id,
        {
          name: nextName ?? undefined,
          iconKey: patch.iconKey,
          sortOrder: patch.sortOrder,
        },
        tx,
      );
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.COMMERCE_VERTICAL_UPDATE,
        targetType: ADMIN_AUDIT_TARGET_TYPES.COMMERCE_VERTICAL,
        targetId: id,
        beforeJson: before,
        afterJson: after,
        sessionId: admin.sessionId,
      });
      return after;
    });
  }

  async activate(admin: CurrentAdminContext, id: string) {
    return this.setActive(
      admin,
      id,
      true,
      ADMIN_AUDIT_ACTIONS.COMMERCE_VERTICAL_ACTIVATE,
    );
  }

  async deactivate(admin: CurrentAdminContext, id: string) {
    return this.setActive(
      admin,
      id,
      false,
      ADMIN_AUDIT_ACTIONS.COMMERCE_VERTICAL_DEACTIVATE,
    );
  }

  async assignBranch(
    admin: CurrentAdminContext,
    branchId: string,
    verticalId: string,
  ) {
    return this.prisma.getDb().transaction(async (tx: OrmClient) => {
      const branch = await this.merchants.findBranchById(branchId, tx);
      if (!branch) {
        throw merchantBranchNotFound();
      }
      const vertical = await this.verticals.findById(verticalId, tx);
      if (!vertical) {
        throw commerceVerticalNotFound();
      }
      if (!vertical.active) {
        throw commerceVerticalInactive();
      }
      const before = await this.verticals.findClassificationByBranch(
        branchId,
        tx,
      );
      const after = await this.verticals.upsertClassification(
        branchId,
        verticalId,
        tx,
      );
      if (before?.verticalId === after.verticalId) {
        return after;
      }
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.COMMERCE_VERTICAL_ASSIGN_BRANCH,
        targetType: ADMIN_AUDIT_TARGET_TYPES.MERCHANT_BRANCH,
        targetId: branchId,
        beforeJson: before,
        afterJson: after,
        sessionId: admin.sessionId,
      });
      return after;
    });
  }

  async unassignBranch(admin: CurrentAdminContext, branchId: string) {
    return this.prisma.getDb().transaction(async (tx: OrmClient) => {
      const removed = await this.verticals.deleteClassification(branchId, tx);
      if (!removed) {
        throw merchantBranchClassificationNotFound();
      }
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action: ADMIN_AUDIT_ACTIONS.COMMERCE_VERTICAL_UNASSIGN_BRANCH,
        targetType: ADMIN_AUDIT_TARGET_TYPES.MERCHANT_BRANCH,
        targetId: branchId,
        beforeJson: removed,
        sessionId: admin.sessionId,
      });
      return { deleted: true as const };
    });
  }

  private async setActive(
    admin: CurrentAdminContext,
    id: string,
    active: boolean,
    action: string,
  ) {
    return this.prisma.getDb().transaction(async (tx: OrmClient) => {
      const before = await this.verticals.findById(id, tx);
      if (!before) {
        throw commerceVerticalNotFound();
      }
      if (before.active === active) {
        return before;
      }
      const after = await this.verticals.update(id, { active }, tx);
      await this.audit.recordInTx(tx, {
        adminId: admin.adminProfileId,
        action,
        targetType: ADMIN_AUDIT_TARGET_TYPES.COMMERCE_VERTICAL,
        targetId: id,
        beforeJson: before,
        afterJson: after,
        sessionId: admin.sessionId,
      });
      return after;
    });
  }
}
