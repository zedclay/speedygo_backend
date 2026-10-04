import { Injectable } from '@nestjs/common';
import {
  pgNow,
  pgTimestamptz,
} from '../../../infrastructure/database/pg-values';
import {
  merchantNotFound,
  merchantRejectionIssuesInvalid,
  merchantVerificationAdminRequired,
  merchantVerificationIntegrity,
  merchantVerificationInvalidState,
  merchantVerificationNotReady,
} from '../domain/merchant.errors';
import {
  MERCHANT_STATUS_ACTIVE,
  MERCHANT_STATUS_PENDING_REVIEW,
  MERCHANT_STATUS_REJECTED,
  MERCHANT_STATUS_SUSPENDED,
  hasDuplicateDocumentTypes,
  isVerificationFormallySubmitted,
  isVerificationReady,
} from '../domain/merchant.policy';
import {
  VERIFICATION_OUTCOME_APPROVED,
  VERIFICATION_OUTCOME_PENDING_REVIEW,
  VERIFICATION_OUTCOME_REJECTED,
  toMerchantView,
  validateRejectionIssues,
  type MerchantView,
  type RejectionIssueInput,
  type ValidatedRejectionIssue,
} from '../domain/merchant.types';
import {
  MerchantRepository,
  type OrmClient,
} from '../infrastructure/merchant.repository';

/**
 * Internal review boundary for Admin Foundation / tests.
 * Not exposed as HTTP.
 *
 * Rejection persists structured issues and the reviewing admin on the
 * verification submission (Merchant Verification Contract Completion).
 * Merchants without submission rows (legacy) get one created on reject.
 *
 * InTx methods run inside a caller-provided transaction (Admin atomic
 * mutation+audit, or public wrappers that open their own TX).
 */
@Injectable()
export class MerchantReviewService {
  constructor(private readonly merchants: MerchantRepository) {}

  async approve(input: {
    merchantId: string;
    adminId: string;
  }): Promise<MerchantView> {
    return this.merchants.runInTransaction((tx) => this.approveInTx(tx, input));
  }

  async approveInTx(
    tx: OrmClient,
    input: { merchantId: string; adminId: string },
  ): Promise<MerchantView> {
    await this.requireAdmin(input.adminId);
    const locked = await this.merchants.lockMerchant(input.merchantId, tx);
    if (!locked) {
      throw merchantNotFound();
    }
    if (locked.status === MERCHANT_STATUS_ACTIVE && locked.verifiedAt) {
      throw merchantVerificationInvalidState('Merchant is already ACTIVE');
    }
    if (locked.status !== MERCHANT_STATUS_PENDING_REVIEW) {
      throw merchantVerificationInvalidState();
    }
    const documents = await this.merchants.listDocumentSummaries(
      input.merchantId,
      tx,
    );
    if (hasDuplicateDocumentTypes(documents)) {
      throw merchantVerificationIntegrity(
        'Duplicate MerchantDocument type rows exist',
      );
    }
    if (!isVerificationFormallySubmitted(documents)) {
      throw merchantVerificationInvalidState(
        'Merchant verification package is not formally submitted',
      );
    }
    if (
      !isVerificationReady({
        name: locked.name,
        documents,
      })
    ) {
      throw merchantVerificationNotReady(
        'Required verification evidence is no longer valid',
      );
    }
    const updated = await this.merchants.setMerchantStatus(
      input.merchantId,
      MERCHANT_STATUS_ACTIVE,
      pgNow(),
      tx,
    );
    if (!updated) {
      throw merchantNotFound();
    }
    const pending = await this.merchants.findLatestSubmission(
      input.merchantId,
      tx,
      VERIFICATION_OUTCOME_PENDING_REVIEW,
    );
    if (pending) {
      await this.merchants.markSubmissionReviewed(
        pending.id,
        VERIFICATION_OUTCOME_APPROVED,
        input.adminId,
        tx,
      );
    }
    await this.merchants.resolveAllIssues(input.merchantId, tx);
    return toMerchantView(updated);
  }

  async reject(input: {
    merchantId: string;
    adminId: string;
    issues: readonly RejectionIssueInput[];
  }): Promise<MerchantView> {
    return this.merchants.runInTransaction((tx) => this.rejectInTx(tx, input));
  }

  async rejectInTx(
    tx: OrmClient,
    input: {
      merchantId: string;
      adminId: string;
      issues: readonly RejectionIssueInput[];
    },
  ): Promise<MerchantView> {
    await this.requireAdmin(input.adminId);
    const locked = await this.merchants.lockMerchant(input.merchantId, tx);
    if (!locked) {
      throw merchantNotFound();
    }
    if (locked.status === MERCHANT_STATUS_REJECTED) {
      throw merchantVerificationInvalidState('Merchant is already REJECTED');
    }
    if (locked.status !== MERCHANT_STATUS_PENDING_REVIEW) {
      throw merchantVerificationInvalidState();
    }
    const documents = await this.merchants.listDocumentSummaries(
      input.merchantId,
      tx,
    );
    if (hasDuplicateDocumentTypes(documents)) {
      throw merchantVerificationIntegrity(
        'Duplicate MerchantDocument type rows exist',
      );
    }
    if (!isVerificationFormallySubmitted(documents)) {
      throw merchantVerificationInvalidState(
        'Merchant verification package is not formally submitted',
      );
    }
    const validation = validateRejectionIssues(
      input.issues,
      documents.map((document) => document.type),
    );
    if (!validation.ok) {
      throw merchantRejectionIssuesInvalid(validation.message);
    }
    const updated = await this.merchants.setMerchantStatus(
      input.merchantId,
      MERCHANT_STATUS_REJECTED,
      null,
      tx,
    );
    await this.merchants.resetDocumentsToPending(input.merchantId, tx);
    if (!updated) {
      throw merchantNotFound();
    }
    await this.recordRejection(
      tx,
      input.merchantId,
      input.adminId,
      validation.issues,
      documents,
    );
    return toMerchantView(updated);
  }

  /**
   * Operational suspension — separate from verification rejection.
   * Does not clear verifiedAt (historical approval truth).
   */
  async suspend(input: {
    merchantId: string;
    adminId: string;
  }): Promise<MerchantView> {
    return this.merchants.runInTransaction((tx) => this.suspendInTx(tx, input));
  }

  async suspendInTx(
    tx: OrmClient,
    input: { merchantId: string; adminId: string },
  ): Promise<MerchantView & { alreadySuspended: boolean }> {
    await this.requireAdmin(input.adminId);
    const locked = await this.merchants.lockMerchant(input.merchantId, tx);
    if (!locked) {
      throw merchantNotFound();
    }
    if (locked.status === MERCHANT_STATUS_SUSPENDED) {
      return { ...toMerchantView(locked), alreadySuspended: true };
    }
    if (locked.status !== MERCHANT_STATUS_ACTIVE || !locked.verifiedAt) {
      throw merchantVerificationInvalidState(
        'Only an ACTIVE verified Merchant can be suspended',
      );
    }
    const updated = await this.merchants.setMerchantStatus(
      input.merchantId,
      MERCHANT_STATUS_SUSPENDED,
      pgTimestamptz(locked.verifiedAt),
      tx,
    );
    if (!updated) {
      throw merchantNotFound();
    }
    return { ...toMerchantView(updated), alreadySuspended: false };
  }

  private async recordRejection(
    tx: OrmClient,
    merchantId: string,
    adminId: string,
    issues: ValidatedRejectionIssue[],
    documents: Awaited<ReturnType<MerchantRepository['listDocumentSummaries']>>,
  ): Promise<void> {
    const pending = await this.merchants.findLatestSubmission(
      merchantId,
      tx,
      VERIFICATION_OUTCOME_PENDING_REVIEW,
    );
    let submissionId: string;
    if (pending) {
      await this.merchants.markSubmissionReviewed(
        pending.id,
        VERIFICATION_OUTCOME_REJECTED,
        adminId,
        tx,
      );
      submissionId = pending.id;
    } else {
      const submitterAccountId = await this.merchants.findOwnerAccountId(
        merchantId,
        tx,
      );
      if (!submitterAccountId) {
        throw merchantVerificationIntegrity(
          'Merchant has no OWNER membership to attribute the legacy submission',
        );
      }
      const created = await this.merchants.createVerificationSubmission(
        { merchantId, submittedByAccountId: submitterAccountId },
        tx,
      );
      await this.merchants.markSubmissionReviewed(
        created.id,
        VERIFICATION_OUTCOME_REJECTED,
        adminId,
        tx,
      );
      submissionId = created.id;
    }
    await this.merchants.createRejectionIssues(
      { submissionId, merchantId, issues, documents },
      tx,
    );
  }

  private async requireAdmin(adminId: string): Promise<void> {
    if (!(await this.merchants.adminExists(adminId))) {
      throw merchantVerificationAdminRequired();
    }
  }
}
