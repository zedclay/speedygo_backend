import { Injectable } from '@nestjs/common';
import {
  merchantNotFound,
  merchantRoleForbidden,
  merchantStatusRestricted,
} from '../domain/merchant.errors';
import {
  isMerchantApproved,
  MERCHANT_CAPABILITIES,
  parseMerchantMemberRole,
  parseMerchantStatus,
  roleHasCapability,
  statusAllowsBranchMutation,
  statusAllowsCatalogMutation,
  statusAllowsProfileUpdate,
  type MerchantCapability,
} from '../domain/merchant.policy';
import type {
  MerchantMemberRecord,
  MerchantRecord,
} from '../domain/merchant.types';
import { MerchantRepository } from '../infrastructure/merchant.repository';

export type MerchantAccessContext = {
  member: MerchantMemberRecord;
  merchant: MerchantRecord;
};

@Injectable()
export class MerchantAccessService {
  constructor(private readonly merchants: MerchantRepository) {}

  async listMemberships(accountId: string): Promise<MerchantMemberRecord[]> {
    return this.merchants.listMembershipsByAccountId(accountId);
  }

  async requireMembership(
    accountId: string,
    merchantId: string,
  ): Promise<MerchantAccessContext> {
    const membership = await this.merchants.findMembership(
      accountId,
      merchantId,
    );
    if (!membership) {
      throw merchantNotFound();
    }
    const merchant = await this.merchants.findMerchant(merchantId);
    if (!merchant) {
      throw merchantNotFound();
    }
    return { member: membership, merchant };
  }

  async requireCapability(
    accountId: string,
    merchantId: string,
    capability: MerchantCapability,
  ): Promise<MerchantAccessContext> {
    const context = await this.requireMembership(accountId, merchantId);
    const role = parseMerchantMemberRole(context.member.role);
    if (!role || !roleHasCapability(role, capability)) {
      throw merchantRoleForbidden();
    }
    if (
      capability === MERCHANT_CAPABILITIES.MERCHANT_READ ||
      capability === MERCHANT_CAPABILITIES.CATALOG_READ ||
      capability === MERCHANT_CAPABILITIES.ORDER_READ ||
      capability === MERCHANT_CAPABILITIES.COMMISSION_READ ||
      capability === MERCHANT_CAPABILITIES.SETTLEMENT_READ
    ) {
      return context;
    }
    const status = parseMerchantStatus(context.merchant.status);
    if (!status) {
      throw merchantStatusRestricted(
        'Merchant status does not allow this action',
      );
    }
    if (capability === MERCHANT_CAPABILITIES.ORDER_WORKFLOW_MUTATE) {
      if (
        !isMerchantApproved(
          context.merchant.status,
          context.merchant.verifiedAt,
        )
      ) {
        throw merchantStatusRestricted(
          'Merchant is not operational for Order workflow',
        );
      }
      return context;
    }
    if (
      capability === MERCHANT_CAPABILITIES.MERCHANT_PROFILE_UPDATE &&
      !statusAllowsProfileUpdate(status)
    ) {
      throw merchantStatusRestricted(
        'Merchant identity cannot be changed in the current status',
      );
    }
    if (
      (capability === MERCHANT_CAPABILITIES.MERCHANT_BRANCH_CREATE ||
        capability === MERCHANT_CAPABILITIES.MERCHANT_BRANCH_UPDATE ||
        capability === MERCHANT_CAPABILITIES.MERCHANT_BRANCH_DELETE) &&
      !statusAllowsBranchMutation(status)
    ) {
      throw merchantStatusRestricted(
        'Branches cannot be changed in the current Merchant status',
      );
    }
    if (
      (capability === MERCHANT_CAPABILITIES.CATEGORY_MANAGE ||
        capability === MERCHANT_CAPABILITIES.PRODUCT_MANAGE ||
        capability === MERCHANT_CAPABILITIES.PRODUCT_OPTIONS_MANAGE) &&
      !statusAllowsCatalogMutation(status)
    ) {
      throw merchantStatusRestricted(
        'Catalog cannot be changed in the current Merchant status',
      );
    }
    return context;
  }
}
