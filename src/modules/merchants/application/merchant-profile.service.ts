import { Injectable } from '@nestjs/common';
import { merchantNotFound } from '../domain/merchant.errors';
import { MERCHANT_CAPABILITIES } from '../domain/merchant.policy';
import {
  toMembershipView,
  type CreateMerchantInput,
  type MerchantMeView,
  type MerchantMembershipView,
  type UpdateMerchantInput,
} from '../domain/merchant.types';
import { MerchantRepository } from '../infrastructure/merchant.repository';
import { MerchantAccessService } from './merchant-access.service';

@Injectable()
export class MerchantProfileService {
  constructor(
    private readonly merchants: MerchantRepository,
    private readonly access: MerchantAccessService,
  ) {}

  async getMe(accountId: string): Promise<MerchantMeView> {
    const memberships = await this.access.listMemberships(accountId);
    if (memberships.length === 0) {
      return { merchantMembershipExists: false, memberships: [] };
    }
    const merchantIds = memberships.map((member) => member.merchantId);
    const [merchants, branches, documents] = await Promise.all([
      this.merchants.findMerchantsByIds(merchantIds),
      this.merchants.listBranchesByMerchantIds(merchantIds),
      this.merchants.listDocumentSummariesByMerchantIds(merchantIds),
    ]);
    const merchantsById = new Map(
      merchants.map((merchant) => [merchant.id, merchant]),
    );
    const branchesByMerchant = new Map<string, typeof branches>();
    for (const branch of branches) {
      const list = branchesByMerchant.get(branch.merchantId) ?? [];
      list.push(branch);
      branchesByMerchant.set(branch.merchantId, list);
    }
    const documentsByMerchant = new Map<string, typeof documents>();
    for (const document of documents) {
      const list = documentsByMerchant.get(document.merchantId) ?? [];
      list.push(document);
      documentsByMerchant.set(document.merchantId, list);
    }
    const membershipViews = memberships.flatMap((member) => {
      const merchant = merchantsById.get(member.merchantId);
      if (!merchant) {
        return [];
      }
      return [
        toMembershipView({
          member,
          merchant,
          branches: branchesByMerchant.get(merchant.id) ?? [],
          documents: documentsByMerchant.get(merchant.id) ?? [],
        }),
      ];
    });
    return {
      merchantMembershipExists: membershipViews.length > 0,
      memberships: membershipViews,
    };
  }

  async create(
    accountId: string,
    input: CreateMerchantInput,
  ): Promise<MerchantMembershipView> {
    const created = await this.merchants.createMerchantWithOwner(
      accountId,
      input,
    );
    return toMembershipView({
      member: created.member,
      merchant: created.merchant,
      branches: [],
      documents: [],
    });
  }

  async update(
    accountId: string,
    merchantId: string,
    input: UpdateMerchantInput,
  ): Promise<MerchantMembershipView> {
    const context = await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.MERCHANT_PROFILE_UPDATE,
    );
    const merchant = await this.merchants.updateMerchant(merchantId, input);
    if (!merchant) {
      throw merchantNotFound();
    }
    const [branches, documents] = await Promise.all([
      this.merchants.listBranches(merchant.id),
      this.merchants.listDocumentSummaries(merchant.id),
    ]);
    return toMembershipView({
      member: context.member,
      merchant,
      branches,
      documents,
    });
  }
}
