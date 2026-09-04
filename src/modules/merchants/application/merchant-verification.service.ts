import { Injectable } from '@nestjs/common';
import {
  merchantDocumentInvalid,
  merchantNotFound,
  merchantVerificationIntegrity,
  merchantVerificationInvalidState,
  merchantVerificationNotReady,
} from '../domain/merchant.errors';
import {
  MERCHANT_CAPABILITIES,
  MERCHANT_MEMBER_ROLE_OWNER,
  MERCHANT_STATUS_PENDING_REVIEW,
  MERCHANT_STATUS_REJECTED,
  canEditVerificationEvidence,
  canSubmitMerchantVerification,
  hasDuplicateDocumentTypes,
  isIsoDate,
  isMerchantDocumentType,
  isOptionalExpiryValid,
  isVerificationFormallySubmitted,
  isVerificationReady,
  parseMerchantMemberRole,
} from '../domain/merchant.policy';
import {
  toMembershipView,
  toVerificationPackageView,
  type MerchantMembershipView,
  type MerchantVerificationPackageView,
  type UpsertMerchantDocumentInput,
} from '../domain/merchant.types';
import { MerchantRepository } from '../infrastructure/merchant.repository';
import { MerchantAccessService } from './merchant-access.service';

@Injectable()
export class MerchantVerificationService {
  constructor(
    private readonly merchants: MerchantRepository,
    private readonly access: MerchantAccessService,
  ) {}

  async getVerification(
    accountId: string,
    merchantId: string,
  ): Promise<MerchantVerificationPackageView> {
    const context = await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.MERCHANT_VERIFICATION_READ,
    );
    const role = parseMerchantMemberRole(context.member.role);
    const documents =
      await this.merchants.listDocumentSummariesBounded(merchantId);
    const packageView = toVerificationPackageView({
      merchant: context.merchant,
      documents,
    });
    if (role !== MERCHANT_MEMBER_ROLE_OWNER) {
      // MANAGER: status / readiness / attention only — no sensitive metadata.
      return {
        ...packageView,
        documents: [],
        evidenceChecklist: [],
        evidenceEditable: false,
      };
    }
    return packageView;
  }

  /**
   * Internal trusted read for future Admin Foundation. No HTTP route.
   */
  async getInternalVerificationPackage(
    merchantId: string,
  ): Promise<MerchantVerificationPackageView> {
    const merchant = await this.merchants.findMerchant(merchantId);
    if (!merchant) {
      throw merchantNotFound();
    }
    const documents =
      await this.merchants.listDocumentSummariesBounded(merchantId);
    return toVerificationPackageView({ merchant, documents });
  }

  async upsertDocument(
    accountId: string,
    merchantId: string,
    input: UpsertMerchantDocumentInput,
  ): Promise<MerchantMembershipView> {
    if (!isMerchantDocumentType(input.type)) {
      throw merchantDocumentInvalid('Unsupported document type');
    }
    if (input.expiryDate) {
      if (!isIsoDate(input.expiryDate)) {
        throw merchantDocumentInvalid('expiryDate must be YYYY-MM-DD');
      }
      if (!isOptionalExpiryValid(input.expiryDate)) {
        throw merchantDocumentInvalid('Document has expired');
      }
    }

    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.MERCHANT_VERIFICATION_MUTATE,
    );

    await this.merchants.runInTransaction(async (tx) => {
      const locked = await this.merchants.lockMerchant(merchantId, tx);
      if (!locked) {
        throw merchantNotFound();
      }
      const documents = await this.merchants.listDocumentSummaries(
        merchantId,
        tx,
      );
      if (hasDuplicateDocumentTypes(documents)) {
        throw merchantVerificationIntegrity(
          'Duplicate MerchantDocument type rows exist',
        );
      }
      if (
        !canEditVerificationEvidence({
          status: locked.status,
          documents,
        })
      ) {
        throw merchantVerificationInvalidState(
          'Verification evidence cannot be changed in the current review state',
        );
      }
      await this.merchants.upsertDocument(
        merchantId,
        input.type,
        input.expiryDate ?? null,
        tx,
      );
    });

    return this.loadMembershipView(accountId, merchantId);
  }

  async submitVerification(
    accountId: string,
    merchantId: string,
  ): Promise<MerchantMembershipView> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.MERCHANT_VERIFICATION_MUTATE,
    );

    await this.merchants.runInTransaction(async (tx) => {
      const locked = await this.merchants.lockMerchant(merchantId, tx);
      if (!locked) {
        throw merchantNotFound();
      }
      if (!canSubmitMerchantVerification(locked.status)) {
        throw merchantVerificationInvalidState();
      }
      const documents = await this.merchants.listDocumentSummaries(
        merchantId,
        tx,
      );
      if (hasDuplicateDocumentTypes(documents)) {
        throw merchantVerificationIntegrity(
          'Duplicate MerchantDocument type rows exist',
        );
      }
      if (
        locked.status === MERCHANT_STATUS_PENDING_REVIEW &&
        isVerificationFormallySubmitted(documents)
      ) {
        throw merchantVerificationInvalidState(
          'Verification package is already submitted for review',
        );
      }
      if (
        !isVerificationReady({
          name: locked.name,
          documents,
        })
      ) {
        throw merchantVerificationNotReady();
      }
      if (locked.status === MERCHANT_STATUS_REJECTED) {
        await this.merchants.setMerchantStatus(
          merchantId,
          MERCHANT_STATUS_PENDING_REVIEW,
          null,
          tx,
        );
      }
      await this.merchants.markDocumentsSubmitted(merchantId, tx);
    });

    return this.loadMembershipView(accountId, merchantId);
  }

  private async loadMembershipView(
    accountId: string,
    merchantId: string,
  ): Promise<MerchantMembershipView> {
    const context = await this.access.requireMembership(accountId, merchantId);
    const [branches, documents] = await Promise.all([
      this.merchants.listBranches(merchantId),
      this.merchants.listDocumentSummaries(merchantId),
    ]);
    return toMembershipView({
      member: context.member,
      merchant: context.merchant,
      branches,
      documents,
      includeDocuments: true,
      includeChecklist: true,
    });
  }
}
