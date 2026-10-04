import { Injectable } from '@nestjs/common';
import { GeoService } from '../../geo/application/geo.service';
import { merchantNotFound } from '../domain/merchant.errors';
import {
  MERCHANT_CAPABILITIES,
  MERCHANT_MEMBER_ROLE_MANAGER,
  MERCHANT_MEMBER_ROLE_OWNER,
  MERCHANT_MEMBER_ROLE_STAFF,
  parseMerchantMemberRole,
} from '../domain/merchant.policy';
import {
  buildVerificationReviewView,
  emptyVerificationReviewView,
  toBranchView,
  toMembershipView,
  type CreateMerchantInput,
  type MerchantBranchRecord,
  type MerchantBranchView,
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
    private readonly geo: GeoService,
  ) {}

  async getMe(accountId: string): Promise<MerchantMeView> {
    const memberships = await this.access.listMemberships(accountId);
    if (memberships.length === 0) {
      return { merchantMembershipExists: false, memberships: [] };
    }
    const merchantIds = memberships.map((member) => member.merchantId);
    const [merchants, branches, documents, verificationRecords] =
      await Promise.all([
        this.merchants.findMerchantsByIds(merchantIds),
        this.merchants.listBranchesByMerchantIds(merchantIds),
        this.merchants.listDocumentSummariesByMerchantIds(merchantIds),
        this.merchants.loadVerificationRecords(merchantIds),
      ]);
    const merchantsById = new Map(
      merchants.map((merchant) => [merchant.id, merchant]),
    );
    const branchViewsByMerchant = await this.branchViewsByMerchantId(branches);
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
      const role = parseMerchantMemberRole(member.role);
      const docs = documentsByMerchant.get(merchant.id) ?? [];
      const includeDocuments = role === MERCHANT_MEMBER_ROLE_OWNER;
      const includeChecklist = role === MERCHANT_MEMBER_ROLE_OWNER;
      const records = verificationRecords.get(merchant.id);
      const view = toMembershipView({
        member,
        merchant,
        branches: [],
        documents: docs,
        includeDocuments,
        includeChecklist,
        branchViews: branchViewsByMerchant.get(merchant.id) ?? [],
        review: records
          ? buildVerificationReviewView(records)
          : emptyVerificationReviewView(),
      });
      if (role === MERCHANT_MEMBER_ROLE_MANAGER) {
        return [
          {
            ...view,
            documents: [],
            evidenceChecklist: [],
          },
        ];
      }
      if (role === MERCHANT_MEMBER_ROLE_STAFF) {
        return [
          {
            ...view,
            documents: [],
            evidenceChecklist: [],
          },
        ];
      }
      return [view];
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
    const [branches, documents, verificationRecords] = await Promise.all([
      this.merchants.listBranches(merchant.id),
      this.merchants.listDocumentSummaries(merchant.id),
      this.merchants.loadVerificationRecords([merchant.id]),
    ]);
    const records = verificationRecords.get(merchant.id);
    return toMembershipView({
      member: context.member,
      merchant,
      branches: [],
      documents,
      branchViews: await this.toBranchViews(branches),
      review: records
        ? buildVerificationReviewView(records)
        : emptyVerificationReviewView(),
    });
  }

  private async toBranchViews(
    branches: MerchantBranchRecord[],
  ): Promise<MerchantBranchView[]> {
    const [names, classifications] = await Promise.all([
      this.geo.resolveDisplayNamesForBranches(branches),
      this.merchants.listBranchClassifications(
        branches.map((branch) => branch.id),
      ),
    ]);
    return branches.map((branch) => {
      const key = `${branch.wilayaCode ?? ''}:${branch.communeId ?? ''}`;
      return toBranchView(
        branch,
        names.get(key),
        classifications.get(branch.id) ?? null,
      );
    });
  }

  private async branchViewsByMerchantId(
    branches: MerchantBranchRecord[],
  ): Promise<Map<string, MerchantBranchView[]>> {
    const views = await this.toBranchViews(branches);
    const byMerchant = new Map<string, MerchantBranchView[]>();
    for (let i = 0; i < branches.length; i++) {
      const branch = branches[i]!;
      const view = views[i]!;
      const list = byMerchant.get(branch.merchantId) ?? [];
      list.push(view);
      byMerchant.set(branch.merchantId, list);
    }
    return byMerchant;
  }
}
