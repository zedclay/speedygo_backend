import { Injectable } from '@nestjs/common';
import { MerchantAccessService } from '../../merchants/application/merchant-access.service';
import {
  merchantBranchNotFound,
  merchantRoleForbidden,
} from '../../merchants/domain/merchant.errors';
import { MERCHANT_CAPABILITIES } from '../../merchants/domain/merchant.policy';
import type { MerchantBranchClassificationView } from '../../merchants/domain/merchant.types';
import { MerchantRepository } from '../../merchants/infrastructure/merchant.repository';
import {
  commerceVerticalInactive,
  commerceVerticalNotFound,
} from '../domain/commerce-vertical.errors';
import type {
  CommerceVerticalRecord,
  CustomerCommerceVerticalView,
} from '../domain/commerce-vertical.types';
import { CommerceVerticalRepository } from '../infrastructure/commerce-vertical.repository';

export type MerchantBranchClassificationResult = {
  branchId: string;
  classification: MerchantBranchClassificationView | null;
};

function toClassificationView(
  vertical: CommerceVerticalRecord,
): MerchantBranchClassificationView {
  return {
    verticalId: vertical.id,
    slug: vertical.slug,
    name: vertical.name,
    iconKey: vertical.iconKey,
  };
}

@Injectable()
export class MerchantBranchClassificationService {
  constructor(
    private readonly access: MerchantAccessService,
    private readonly merchants: MerchantRepository,
    private readonly verticals: CommerceVerticalRepository,
  ) {}

  /** Active verticals for the Merchant picker. Any Merchant member (all roles). */
  async listActiveVerticals(
    accountId: string,
  ): Promise<{ items: CustomerCommerceVerticalView[] }> {
    const memberships = await this.access.listMemberships(accountId);
    if (memberships.length === 0) {
      throw merchantRoleForbidden();
    }
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

  async get(
    accountId: string,
    merchantId: string,
    branchId: string,
  ): Promise<MerchantBranchClassificationResult> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.MERCHANT_READ,
    );
    await this.requireOwnedBranch(merchantId, branchId);
    return this.read(branchId);
  }

  async assign(
    accountId: string,
    merchantId: string,
    branchId: string,
    verticalId: string,
  ): Promise<MerchantBranchClassificationResult> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.MERCHANT_BRANCH_UPDATE,
    );
    await this.requireOwnedBranch(merchantId, branchId);
    const vertical = await this.verticals.findById(verticalId);
    if (!vertical) {
      throw commerceVerticalNotFound();
    }
    if (!vertical.active) {
      throw commerceVerticalInactive();
    }
    await this.verticals.upsertClassification(branchId, verticalId);
    return { branchId, classification: toClassificationView(vertical) };
  }

  async clear(
    accountId: string,
    merchantId: string,
    branchId: string,
  ): Promise<MerchantBranchClassificationResult> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.MERCHANT_BRANCH_UPDATE,
    );
    await this.requireOwnedBranch(merchantId, branchId);
    await this.verticals.deleteClassification(branchId);
    return { branchId, classification: null };
  }

  private async read(
    branchId: string,
  ): Promise<MerchantBranchClassificationResult> {
    const assigned = await this.verticals.findClassificationByBranch(branchId);
    if (!assigned) {
      return { branchId, classification: null };
    }
    const vertical = await this.verticals.findById(assigned.verticalId);
    return {
      branchId,
      classification: vertical ? toClassificationView(vertical) : null,
    };
  }

  private async requireOwnedBranch(merchantId: string, branchId: string) {
    const branch = await this.merchants.findOwnedBranch(merchantId, branchId);
    if (!branch) {
      throw merchantBranchNotFound();
    }
    return branch;
  }
}
