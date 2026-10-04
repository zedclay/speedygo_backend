import { MERCHANT_ERROR_CODES } from '../domain/merchant.errors';
import {
  LEGAL_KIND_DOSSIER_ACCURACY_DECLARATION,
  LEGAL_KIND_MERCHANT_TERMS,
  LEGAL_SEED_VERSION,
  MERCHANT_DOCUMENT_BUSINESS_IDENTITY,
  MERCHANT_DOCUMENT_BUSINESS_REGISTRATION,
  MERCHANT_DOCUMENT_STATUS_PENDING,
  MERCHANT_DOCUMENT_STATUS_SUBMITTED,
  MERCHANT_DOCUMENT_SUPPORTING,
  MERCHANT_MEMBER_ROLE_OWNER,
  MERCHANT_STATUS_ACTIVE,
  MERCHANT_STATUS_PENDING_REVIEW,
  MERCHANT_STATUS_REJECTED,
  MERCHANT_STATUS_SUSPENDED,
  VERIFICATION_OUTCOME_APPROVED,
  VERIFICATION_OUTCOME_PENDING_REVIEW,
  VERIFICATION_OUTCOME_REJECTED,
  pickCurrentLegalVersions,
  type LegalAcceptanceRecord,
  type LegalDocumentVersionRecord,
  type MerchantDocumentSummary,
  type MerchantMemberRecord,
  type MerchantRecord,
  type MerchantVerificationRecords,
  type RejectionIssueInput,
  type ValidatedRejectionIssue,
  type VerificationIssueRecord,
  type VerificationSubmissionRecord,
} from '../domain/merchant.types';
import { MerchantRepository } from '../infrastructure/merchant.repository';
import { MerchantAccessService } from './merchant-access.service';
import { MerchantReviewService } from './merchant-review.service';
import { MerchantVerificationService } from './merchant-verification.service';

const ACCOUNT_OWNER = '11111111-1111-7111-8111-111111111111';
const ACCOUNT_OTHER = '22222222-2222-7222-8222-222222222222';
const ADMIN_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const FAKE_ADMIN = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';

function now(): string {
  return new Date().toISOString();
}

class MemoryMerchantRepository {
  merchants = new Map<string, MerchantRecord>();
  members: MerchantMemberRecord[] = [];
  documents = new Map<string, MerchantDocumentSummary[]>();
  admins = new Set<string>([ADMIN_ID]);
  legalVersions: LegalDocumentVersionRecord[] = [];
  submissions: VerificationSubmissionRecord[] = [];
  acceptances: LegalAcceptanceRecord[] = [];
  issues: VerificationIssueRecord[] = [];
  private idSeq = 0;
  private chain: Promise<unknown> = Promise.resolve();

  listMembershipsByAccountId(
    accountId: string,
  ): Promise<MerchantMemberRecord[]> {
    return Promise.resolve(
      this.members.filter((row) => row.accountId === accountId),
    );
  }

  findMembership(
    accountId: string,
    merchantId: string,
  ): Promise<MerchantMemberRecord | null> {
    return Promise.resolve(
      this.members.find(
        (row) => row.accountId === accountId && row.merchantId === merchantId,
      ) ?? null,
    );
  }

  findMerchant(id: string): Promise<MerchantRecord | null> {
    return Promise.resolve(this.merchants.get(id) ?? null);
  }

  findMerchantInTx(merchantId: string): Promise<MerchantRecord | null> {
    return this.findMerchant(merchantId);
  }

  listBranches(): Promise<never[]> {
    return Promise.resolve([]);
  }

  listDocumentSummaries(
    merchantId: string,
  ): Promise<MerchantDocumentSummary[]> {
    return Promise.resolve([...(this.documents.get(merchantId) ?? [])]);
  }

  listDocumentSummariesBounded(
    merchantId: string,
  ): Promise<MerchantDocumentSummary[]> {
    return this.listDocumentSummaries(merchantId);
  }

  adminExists(adminId: string): Promise<boolean> {
    return Promise.resolve(this.admins.has(adminId));
  }

  runInTransaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
    const previous = this.chain;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.chain = previous.then(() => gate);
    return previous.then(async () => {
      try {
        return await fn(this);
      } finally {
        release();
      }
    });
  }

  lockMerchant(merchantId: string): Promise<MerchantRecord | null> {
    return Promise.resolve(this.merchants.get(merchantId) ?? null);
  }

  setMerchantStatus(
    merchantId: string,
    status: string,
    verifiedAt: string | null,
  ): Promise<MerchantRecord | null> {
    const merchant = this.merchants.get(merchantId);
    if (!merchant) {
      return Promise.resolve(null);
    }
    const next = {
      ...merchant,
      status,
      verifiedAt,
      updatedAt: now(),
    };
    this.merchants.set(merchantId, next);
    return Promise.resolve(next);
  }

  upsertDocument(
    merchantId: string,
    type: string,
    expiryDate: string | null,
  ): Promise<MerchantDocumentSummary> {
    const list = this.documents.get(merchantId) ?? [];
    const existing = list.find((row) => row.type === type);
    if (existing) {
      existing.expiryDate = expiryDate;
      existing.status = MERCHANT_DOCUMENT_STATUS_PENDING;
      return Promise.resolve(existing);
    }
    const created: MerchantDocumentSummary = {
      id: `doc-${type}-${merchantId.slice(0, 8)}`,
      merchantId,
      type,
      status: MERCHANT_DOCUMENT_STATUS_PENDING,
      expiryDate,
    };
    list.push(created);
    this.documents.set(merchantId, list);
    return Promise.resolve(created);
  }

  updateDocumentFileUrl(): Promise<void> {
    return Promise.resolve();
  }

  markDocumentsSubmitted(merchantId: string): Promise<void> {
    const list = this.documents.get(merchantId) ?? [];
    for (const row of list) {
      row.status = MERCHANT_DOCUMENT_STATUS_SUBMITTED;
    }
    return Promise.resolve();
  }

  resetDocumentsToPending(merchantId: string): Promise<void> {
    const list = this.documents.get(merchantId) ?? [];
    for (const row of list) {
      row.status = MERCHANT_DOCUMENT_STATUS_PENDING;
    }
    return Promise.resolve();
  }

  private nextId(prefix: string): string {
    this.idSeq += 1;
    return `${prefix}-${this.idSeq}`;
  }

  listActiveLegalVersions(): Promise<LegalDocumentVersionRecord[]> {
    return Promise.resolve(pickCurrentLegalVersions(this.legalVersions));
  }

  async ensureActiveLegalVersions(): Promise<LegalDocumentVersionRecord[]> {
    for (const kind of [
      LEGAL_KIND_MERCHANT_TERMS,
      LEGAL_KIND_DOSSIER_ACCURACY_DECLARATION,
    ]) {
      if (!this.legalVersions.some((row) => row.kind === kind && row.active)) {
        this.legalVersions.push({
          id: this.nextId('legal'),
          kind,
          version: LEGAL_SEED_VERSION,
          contentUrl: null,
          contentSha256: null,
          effectiveFrom: now(),
          active: true,
        });
      }
    }
    return this.listActiveLegalVersions();
  }

  findLatestSubmission(
    merchantId: string,
    _tx: unknown,
    outcome?: string,
  ): Promise<VerificationSubmissionRecord | null> {
    const rows = this.submissions
      .filter(
        (row) =>
          row.merchantId === merchantId &&
          (outcome === undefined || row.outcome === outcome),
      )
      .sort((a, b) => b.attemptNumber - a.attemptNumber);
    return Promise.resolve(rows[0] ?? null);
  }

  async createVerificationSubmission(input: {
    merchantId: string;
    submittedByAccountId: string;
  }): Promise<VerificationSubmissionRecord> {
    const previous = await this.findLatestSubmission(input.merchantId, null);
    const row: VerificationSubmissionRecord = {
      id: this.nextId('sub'),
      merchantId: input.merchantId,
      attemptNumber: (previous?.attemptNumber ?? 0) + 1,
      submittedAt: now(),
      submittedByAccountId: input.submittedByAccountId,
      outcome: VERIFICATION_OUTCOME_PENDING_REVIEW,
      reviewedAt: null,
      reviewedByAdminId: null,
    };
    this.submissions.push(row);
    return row;
  }

  createLegalAcceptances(input: {
    merchantId: string;
    submissionId: string;
    acceptances: Array<{ kind: string; version: string }>;
  }): Promise<void> {
    for (const acceptance of input.acceptances) {
      this.acceptances.push({
        id: this.nextId('acc'),
        merchantId: input.merchantId,
        submissionId: input.submissionId,
        kind: acceptance.kind,
        version: acceptance.version,
        acceptedAt: now(),
      });
    }
    return Promise.resolve();
  }

  markSubmissionReviewed(
    submissionId: string,
    outcome: string,
    adminId: string,
  ): Promise<void> {
    const row = this.submissions.find((item) => item.id === submissionId)!;
    row.outcome = outcome;
    row.reviewedAt = now();
    row.reviewedByAdminId = adminId;
    return Promise.resolve();
  }

  findOwnerAccountId(): Promise<string | null> {
    return Promise.resolve(ACCOUNT_OWNER);
  }

  createRejectionIssues(input: {
    submissionId: string;
    merchantId: string;
    issues: ValidatedRejectionIssue[];
    documents: MerchantDocumentSummary[];
  }): Promise<void> {
    for (const issue of input.issues) {
      this.issues.push({
        id: this.nextId('issue'),
        submissionId: input.submissionId,
        merchantId: input.merchantId,
        scope: issue.scope,
        documentType: issue.documentType,
        documentId:
          input.documents.find((doc) => doc.type === issue.documentType)?.id ??
          null,
        code: issue.code,
        messageFr: issue.messageFr,
        resolvedAt: null,
        createdAt: now(),
      });
    }
    return Promise.resolve();
  }

  async resolveDocumentIssuesForType(
    merchantId: string,
    documentType: string,
  ): Promise<void> {
    const rejected = await this.findLatestSubmission(
      merchantId,
      null,
      VERIFICATION_OUTCOME_REJECTED,
    );
    if (!rejected) {
      return;
    }
    for (const issue of this.issues) {
      if (
        issue.submissionId === rejected.id &&
        issue.scope === 'DOCUMENT' &&
        issue.documentType === documentType &&
        issue.resolvedAt === null
      ) {
        issue.resolvedAt = now();
      }
    }
  }

  resolveAllIssues(merchantId: string): Promise<void> {
    for (const issue of this.issues) {
      if (issue.merchantId === merchantId && issue.resolvedAt === null) {
        issue.resolvedAt = now();
      }
    }
    return Promise.resolve();
  }

  loadVerificationRecords(
    merchantIds: string[],
  ): Promise<Map<string, MerchantVerificationRecords>> {
    const result = new Map<string, MerchantVerificationRecords>();
    for (const id of merchantIds) {
      const submissions = this.submissions.filter(
        (row) => row.merchantId === id,
      );
      if (submissions.length === 0) {
        continue;
      }
      result.set(id, {
        submissions: submissions.map((row) => ({ ...row })),
        acceptances: this.acceptances.filter((row) => row.merchantId === id),
        unresolvedIssues: this.issues.filter(
          (row) => row.merchantId === id && row.resolvedAt === null,
        ),
      });
    }
    return Promise.resolve(result);
  }

  seedMerchant(name = 'Cafe'): MerchantRecord {
    const merchant: MerchantRecord = {
      id: `merchant-${this.merchants.size + 1}`,
      publicReference: `sgm_${this.merchants.size + 1}`,
      name,
      status: MERCHANT_STATUS_PENDING_REVIEW,
      verifiedAt: null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.merchants.set(merchant.id, merchant);
    this.members.push({
      id: `member-${merchant.id}`,
      merchantId: merchant.id,
      accountId: ACCOUNT_OWNER,
      role: MERCHANT_MEMBER_ROLE_OWNER,
      createdAt: now(),
    });
    this.documents.set(merchant.id, []);
    return merchant;
  }
}

describe('MerchantVerificationService + MerchantReviewService', () => {
  let repo: MemoryMerchantRepository;
  let access: MerchantAccessService;
  let verification: MerchantVerificationService;
  let review: MerchantReviewService;

  beforeEach(() => {
    repo = new MemoryMerchantRepository();
    access = new MerchantAccessService(repo as unknown as MerchantRepository);
    verification = new MerchantVerificationService(
      repo as unknown as MerchantRepository,
      access,
      {
        uploadPending: jest.fn(),
        promotePendingToPermanent: jest.fn(),
        deletePermanentLocator: jest.fn(),
        readDurableContent: jest.fn(),
        readBoundContent: jest.fn(),
      } as never,
    );
    review = new MerchantReviewService(repo as unknown as MerchantRepository);
  });

  const ACCEPT_ALL = [
    { kind: LEGAL_KIND_MERCHANT_TERMS, version: LEGAL_SEED_VERSION },
    {
      kind: LEGAL_KIND_DOSSIER_ACCURACY_DECLARATION,
      version: LEGAL_SEED_VERSION,
    },
  ];

  const REGISTRATION_ISSUE: RejectionIssueInput = {
    scope: 'DOCUMENT',
    code: 'DOCUMENT_ILLEGIBLE',
    messageFr: 'Le document est illisible.',
    documentType: MERCHANT_DOCUMENT_BUSINESS_REGISTRATION,
  };

  const APPLICATION_ISSUE: RejectionIssueInput = {
    scope: 'APPLICATION',
    code: 'PROFILE_INCOMPLETE',
    messageFr: 'Le profil est incomplet.',
  };

  async function registerRequired(merchantId: string): Promise<void> {
    await verification.upsertDocument(ACCOUNT_OWNER, merchantId, {
      type: MERCHANT_DOCUMENT_BUSINESS_IDENTITY,
    });
    await verification.upsertDocument(ACCOUNT_OWNER, merchantId, {
      type: MERCHANT_DOCUMENT_BUSINESS_REGISTRATION,
    });
  }

  it('blocks incomplete submission and accepts complete package without ACTIVE', async () => {
    const merchant = repo.seedMerchant();
    await expect(
      verification.submitVerification(ACCOUNT_OWNER, merchant.id, ACCEPT_ALL),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_VERIFICATION_NOT_READY,
    });
    await registerRequired(merchant.id);
    const membership = await verification.getVerification(
      ACCOUNT_OWNER,
      merchant.id,
    );
    expect(membership.verificationReady).toBe(true);
    expect(membership.verificationSubmitted).toBe(false);
    await expect(
      review.approve({ merchantId: merchant.id, adminId: ADMIN_ID }),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_VERIFICATION_INVALID_STATE,
    });
    const submitted = await verification.submitVerification(
      ACCOUNT_OWNER,
      merchant.id,
      ACCEPT_ALL,
    );
    expect(submitted.verificationSubmitted).toBe(true);
    expect(submitted.merchant.status).toBe(MERCHANT_STATUS_PENDING_REVIEW);
    expect(submitted.merchant.verifiedAt).toBeNull();
    await expect(
      verification.submitVerification(ACCOUNT_OWNER, merchant.id, ACCEPT_ALL),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_VERIFICATION_INVALID_STATE,
    });
  });

  it('blocks evidence mutation while submitted and while ACTIVE', async () => {
    const merchant = repo.seedMerchant();
    await registerRequired(merchant.id);
    await verification.submitVerification(
      ACCOUNT_OWNER,
      merchant.id,
      ACCEPT_ALL,
    );
    await expect(
      verification.upsertDocument(ACCOUNT_OWNER, merchant.id, {
        type: MERCHANT_DOCUMENT_BUSINESS_IDENTITY,
      }),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_VERIFICATION_INVALID_STATE,
    });
    await review.approve({ merchantId: merchant.id, adminId: ADMIN_ID });
    await expect(
      verification.upsertDocument(ACCOUNT_OWNER, merchant.id, {
        type: MERCHANT_DOCUMENT_SUPPORTING,
      }),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_VERIFICATION_INVALID_STATE,
    });
  });

  it('rejects with structured issues and supports resubmission', async () => {
    const merchant = repo.seedMerchant();
    await registerRequired(merchant.id);
    await verification.submitVerification(
      ACCOUNT_OWNER,
      merchant.id,
      ACCEPT_ALL,
    );
    const rejected = await review.reject({
      merchantId: merchant.id,
      adminId: ADMIN_ID,
      issues: [APPLICATION_ISSUE],
    });
    expect(rejected.status).toBe(MERCHANT_STATUS_REJECTED);
    expect(repo.merchants.has(merchant.id)).toBe(true);
    expect(repo.members.length).toBe(1);
    await registerRequired(merchant.id);
    const resubmitted = await verification.submitVerification(
      ACCOUNT_OWNER,
      merchant.id,
      ACCEPT_ALL,
    );
    expect(resubmitted.merchant.status).toBe(MERCHANT_STATUS_PENDING_REVIEW);
    expect(resubmitted.verificationSubmitted).toBe(true);
  });

  it('fails closed on duplicate same-type document rows', async () => {
    const merchant = repo.seedMerchant();
    await registerRequired(merchant.id);
    const docs = repo.documents.get(merchant.id)!;
    docs.push({
      id: 'dup-identity',
      merchantId: merchant.id,
      type: MERCHANT_DOCUMENT_BUSINESS_IDENTITY,
      status: MERCHANT_DOCUMENT_STATUS_PENDING,
      expiryDate: null,
    });
    await expect(
      verification.submitVerification(ACCOUNT_OWNER, merchant.id, ACCEPT_ALL),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_VERIFICATION_INTEGRITY,
    });
  });

  it('blocks foreign merchant evidence and untrusted admin approval', async () => {
    const merchant = repo.seedMerchant();
    await expect(
      verification.upsertDocument(ACCOUNT_OTHER, merchant.id, {
        type: MERCHANT_DOCUMENT_BUSINESS_IDENTITY,
      }),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_NOT_FOUND,
    });
    await registerRequired(merchant.id);
    await verification.submitVerification(
      ACCOUNT_OWNER,
      merchant.id,
      ACCEPT_ALL,
    );
    await expect(
      review.approve({ merchantId: merchant.id, adminId: FAKE_ADMIN }),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_VERIFICATION_ADMIN_REQUIRED,
    });
  });

  it('fails approval when supplied expiry becomes invalid before review', async () => {
    const merchant = repo.seedMerchant();
    await verification.upsertDocument(ACCOUNT_OWNER, merchant.id, {
      type: MERCHANT_DOCUMENT_BUSINESS_IDENTITY,
    });
    await verification.upsertDocument(ACCOUNT_OWNER, merchant.id, {
      type: MERCHANT_DOCUMENT_BUSINESS_REGISTRATION,
      expiryDate: '2099-06-01',
    });
    await verification.submitVerification(
      ACCOUNT_OWNER,
      merchant.id,
      ACCEPT_ALL,
    );
    const docs = repo.documents.get(merchant.id)!;
    const reg = docs.find(
      (row) => row.type === MERCHANT_DOCUMENT_BUSINESS_REGISTRATION,
    )!;
    reg.expiryDate = '2020-01-01';
    await expect(
      review.approve({ merchantId: merchant.id, adminId: ADMIN_ID }),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_VERIFICATION_NOT_READY,
    });
    expect(repo.merchants.get(merchant.id)?.status).toBe(
      MERCHANT_STATUS_PENDING_REVIEW,
    );
  });

  it('does not reactivate SUSPENDED Merchants via approval', async () => {
    const merchant = repo.seedMerchant();
    await registerRequired(merchant.id);
    await verification.submitVerification(
      ACCOUNT_OWNER,
      merchant.id,
      ACCEPT_ALL,
    );
    await review.approve({ merchantId: merchant.id, adminId: ADMIN_ID });
    await review.suspend({ merchantId: merchant.id, adminId: ADMIN_ID });
    expect(repo.merchants.get(merchant.id)?.status).toBe(
      MERCHANT_STATUS_SUSPENDED,
    );
    await expect(
      review.approve({ merchantId: merchant.id, adminId: ADMIN_ID }),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_VERIFICATION_INVALID_STATE,
    });
  });

  it('serializes concurrent approve and reject to one legal outcome', async () => {
    const merchant = repo.seedMerchant();
    await registerRequired(merchant.id);
    await verification.submitVerification(
      ACCOUNT_OWNER,
      merchant.id,
      ACCEPT_ALL,
    );
    const results = await Promise.allSettled([
      review.approve({ merchantId: merchant.id, adminId: ADMIN_ID }),
      review.reject({
        merchantId: merchant.id,
        adminId: ADMIN_ID,
        issues: [APPLICATION_ISSUE],
      }),
    ]);
    const fulfilled = results.filter((row) => row.status === 'fulfilled');
    const rejected = results.filter((row) => row.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    const status = repo.merchants.get(merchant.id)!.status;
    expect([MERCHANT_STATUS_ACTIVE, MERCHANT_STATUS_REJECTED]).toContain(
      status,
    );
  });

  it('requires both legal acceptances at the current versions', async () => {
    const merchant = repo.seedMerchant();
    await registerRequired(merchant.id);
    const submit = (acceptances?: Array<{ kind: string; version: string }>) =>
      verification.submitVerification(ACCOUNT_OWNER, merchant.id, acceptances);

    await expect(submit(undefined)).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.LEGAL_ACCEPTANCE_REQUIRED,
      httpStatus: 400,
    });
    await expect(submit([])).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.LEGAL_ACCEPTANCE_REQUIRED,
    });
    await expect(submit([ACCEPT_ALL[0]!])).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.LEGAL_ACCEPTANCE_REQUIRED,
    });
    await expect(
      submit([ACCEPT_ALL[0]!, { ...ACCEPT_ALL[1]!, version: '2000-01-01' }]),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.LEGAL_VERSION_OUTDATED,
    });
    expect(repo.submissions).toHaveLength(0);
    expect(repo.acceptances).toHaveLength(0);
    expect(repo.documents.get(merchant.id)!.map((d) => d.status)).toEqual([
      MERCHANT_DOCUMENT_STATUS_PENDING,
      MERCHANT_DOCUMENT_STATUS_PENDING,
    ]);
  });

  it('seeds and returns the current legal versions', async () => {
    const legal = await verification.getCurrentLegalVersions();
    expect(legal.versions.map((row) => row.kind).sort()).toEqual([
      LEGAL_KIND_DOSSIER_ACCURACY_DECLARATION,
      LEGAL_KIND_MERCHANT_TERMS,
    ]);
    expect(
      legal.versions.every((row) => row.version === LEGAL_SEED_VERSION),
    ).toBe(true);
  });

  it('records a submission with acceptances and exposes them to OWNER', async () => {
    const merchant = repo.seedMerchant();
    await registerRequired(merchant.id);
    const submitted = await verification.submitVerification(
      ACCOUNT_OWNER,
      merchant.id,
      ACCEPT_ALL,
    );
    expect(repo.submissions).toHaveLength(1);
    expect(repo.submissions[0]).toMatchObject({
      attemptNumber: 1,
      outcome: VERIFICATION_OUTCOME_PENDING_REVIEW,
      submittedByAccountId: ACCOUNT_OWNER,
    });
    expect(repo.acceptances).toHaveLength(2);
    expect(submitted.attemptNumber).toBe(1);
    expect(submitted.submittedAt).toBe(repo.submissions[0]!.submittedAt);
    expect(submitted.legalAcceptance).toMatchObject({
      termsVersion: LEGAL_SEED_VERSION,
      declarationVersion: LEGAL_SEED_VERSION,
    });
    expect(submitted.unresolvedIssueCount).toBe(0);
  });

  it('validates structured rejection issues before changing state', async () => {
    const merchant = repo.seedMerchant();
    await registerRequired(merchant.id);
    await verification.submitVerification(
      ACCOUNT_OWNER,
      merchant.id,
      ACCEPT_ALL,
    );
    const bad: RejectionIssueInput[][] = [
      [],
      [{ scope: 'APPLICATION', code: 'DOCUMENT_MISSING', messageFr: 'x' }],
      [{ scope: 'DOCUMENT', code: 'OTHER_DOCUMENT', messageFr: 'x' }],
      [
        {
          scope: 'DOCUMENT',
          code: 'OTHER_DOCUMENT',
          messageFr: 'x',
          documentType: MERCHANT_DOCUMENT_SUPPORTING,
        },
      ],
      [{ scope: 'APPLICATION', code: 'OTHER_APPLICATION', messageFr: '   ' }],
      [{ scope: 'OTHER', code: 'OTHER_APPLICATION', messageFr: 'x' }],
    ];
    for (const issues of bad) {
      await expect(
        review.reject({ merchantId: merchant.id, adminId: ADMIN_ID, issues }),
      ).rejects.toMatchObject({
        code: MERCHANT_ERROR_CODES.MERCHANT_REJECTION_ISSUES_INVALID,
      });
    }
    expect(repo.merchants.get(merchant.id)!.status).toBe(
      MERCHANT_STATUS_PENDING_REVIEW,
    );
    expect(repo.issues).toHaveLength(0);
  });

  it('stores structured issues on the rejected submission and exposes currentIssues', async () => {
    const merchant = repo.seedMerchant();
    await registerRequired(merchant.id);
    await verification.submitVerification(
      ACCOUNT_OWNER,
      merchant.id,
      ACCEPT_ALL,
    );
    await review.reject({
      merchantId: merchant.id,
      adminId: ADMIN_ID,
      issues: [APPLICATION_ISSUE, REGISTRATION_ISSUE],
    });
    expect(repo.submissions[0]).toMatchObject({
      outcome: VERIFICATION_OUTCOME_REJECTED,
      reviewedByAdminId: ADMIN_ID,
    });
    expect(repo.submissions[0]!.reviewedAt).not.toBeNull();
    expect(repo.issues).toHaveLength(2);
    expect(
      repo.issues.every((i) => i.submissionId === repo.submissions[0]!.id),
    ).toBe(true);
    expect(
      repo.issues.find((i) => i.scope === 'DOCUMENT')!.documentId,
    ).not.toBeNull();

    const pkg = await verification.getVerification(ACCOUNT_OWNER, merchant.id);
    expect(pkg.unresolvedIssueCount).toBe(2);
    expect(pkg.currentIssues.map((i) => i.code).sort()).toEqual([
      'DOCUMENT_ILLEGIBLE',
      'PROFILE_INCOMPLETE',
    ]);
    expect(pkg.reviewedAt).not.toBeNull();
  });

  it('creates a legacy submission when rejecting a Merchant with no submission row', async () => {
    const merchant = repo.seedMerchant();
    await registerRequired(merchant.id);
    // Legacy: documents SUBMITTED without any submission row.
    await repo.markDocumentsSubmitted(merchant.id);
    expect(repo.submissions).toHaveLength(0);
    await review.reject({
      merchantId: merchant.id,
      adminId: ADMIN_ID,
      issues: [APPLICATION_ISSUE],
    });
    expect(repo.submissions).toHaveLength(1);
    expect(repo.submissions[0]).toMatchObject({
      attemptNumber: 1,
      outcome: VERIFICATION_OUTCOME_REJECTED,
      reviewedByAdminId: ADMIN_ID,
    });
    expect(repo.issues).toHaveLength(1);
  });

  it('resolves DOCUMENT issues for a type when OWNER rebinds it while REJECTED', async () => {
    const merchant = repo.seedMerchant();
    await registerRequired(merchant.id);
    await verification.submitVerification(
      ACCOUNT_OWNER,
      merchant.id,
      ACCEPT_ALL,
    );
    await review.reject({
      merchantId: merchant.id,
      adminId: ADMIN_ID,
      issues: [
        APPLICATION_ISSUE,
        REGISTRATION_ISSUE,
        {
          scope: 'DOCUMENT',
          code: 'DOCUMENT_EXPIRED',
          messageFr: 'Le document est expiré.',
          documentType: MERCHANT_DOCUMENT_BUSINESS_IDENTITY,
        },
      ],
    });
    const view = await verification.upsertDocument(ACCOUNT_OWNER, merchant.id, {
      type: MERCHANT_DOCUMENT_BUSINESS_REGISTRATION,
    });
    const byCode = (code: string) =>
      repo.issues.find((issue) => issue.code === code)!;
    expect(byCode('DOCUMENT_ILLEGIBLE').resolvedAt).not.toBeNull();
    expect(byCode('DOCUMENT_EXPIRED').resolvedAt).toBeNull();
    expect(byCode('PROFILE_INCOMPLETE').resolvedAt).toBeNull();
    expect(view.unresolvedIssueCount).toBe(2);
    expect(view.currentIssues.map((i) => i.code)).not.toContain(
      'DOCUMENT_ILLEGIBLE',
    );
  });

  it('does not resolve issues when a document is upserted outside REJECTED', async () => {
    const merchant = repo.seedMerchant();
    await verification.upsertDocument(ACCOUNT_OWNER, merchant.id, {
      type: MERCHANT_DOCUMENT_BUSINESS_REGISTRATION,
    });
    expect(repo.issues).toHaveLength(0);
  });

  it('increments attemptNumber on resubmission and approval resolves open issues', async () => {
    const merchant = repo.seedMerchant();
    await registerRequired(merchant.id);
    await verification.submitVerification(
      ACCOUNT_OWNER,
      merchant.id,
      ACCEPT_ALL,
    );
    await review.reject({
      merchantId: merchant.id,
      adminId: ADMIN_ID,
      issues: [APPLICATION_ISSUE],
    });
    await registerRequired(merchant.id);
    const resubmitted = await verification.submitVerification(
      ACCOUNT_OWNER,
      merchant.id,
      ACCEPT_ALL,
    );
    expect(resubmitted.attemptNumber).toBe(2);
    expect(repo.submissions.map((s) => s.outcome)).toEqual([
      VERIFICATION_OUTCOME_REJECTED,
      VERIFICATION_OUTCOME_PENDING_REVIEW,
    ]);
    expect(repo.acceptances).toHaveLength(4);

    await review.approve({ merchantId: merchant.id, adminId: ADMIN_ID });
    expect(repo.submissions[1]).toMatchObject({
      outcome: VERIFICATION_OUTCOME_APPROVED,
      reviewedByAdminId: ADMIN_ID,
    });
    expect(repo.submissions[1]!.reviewedAt).not.toBeNull();
    expect(repo.issues.every((issue) => issue.resolvedAt !== null)).toBe(true);
    const pkg = await verification.getVerification(ACCOUNT_OWNER, merchant.id);
    expect(pkg.unresolvedIssueCount).toBe(0);
    expect(pkg.currentIssues).toEqual([]);
  });
});
