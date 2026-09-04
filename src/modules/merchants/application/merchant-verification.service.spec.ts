import { MERCHANT_ERROR_CODES } from '../domain/merchant.errors';
import {
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
  type MerchantDocumentSummary,
  type MerchantMemberRecord,
  type MerchantRecord,
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
    );
    review = new MerchantReviewService(repo as unknown as MerchantRepository);
  });

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
      verification.submitVerification(ACCOUNT_OWNER, merchant.id),
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
    );
    expect(submitted.verificationSubmitted).toBe(true);
    expect(submitted.merchant.status).toBe(MERCHANT_STATUS_PENDING_REVIEW);
    expect(submitted.merchant.verifiedAt).toBeNull();
    await expect(
      verification.submitVerification(ACCOUNT_OWNER, merchant.id),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_VERIFICATION_INVALID_STATE,
    });
  });

  it('blocks evidence mutation while submitted and while ACTIVE', async () => {
    const merchant = repo.seedMerchant();
    await registerRequired(merchant.id);
    await verification.submitVerification(ACCOUNT_OWNER, merchant.id);
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

  it('rejects without inventing a stored reason and supports resubmission', async () => {
    const merchant = repo.seedMerchant();
    await registerRequired(merchant.id);
    await verification.submitVerification(ACCOUNT_OWNER, merchant.id);
    const rejected = await review.reject({
      merchantId: merchant.id,
      adminId: ADMIN_ID,
    });
    expect(rejected.status).toBe(MERCHANT_STATUS_REJECTED);
    expect(repo.merchants.has(merchant.id)).toBe(true);
    expect(repo.members.length).toBe(1);
    await registerRequired(merchant.id);
    const resubmitted = await verification.submitVerification(
      ACCOUNT_OWNER,
      merchant.id,
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
      verification.submitVerification(ACCOUNT_OWNER, merchant.id),
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
    await verification.submitVerification(ACCOUNT_OWNER, merchant.id);
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
    await verification.submitVerification(ACCOUNT_OWNER, merchant.id);
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
    await verification.submitVerification(ACCOUNT_OWNER, merchant.id);
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
    await verification.submitVerification(ACCOUNT_OWNER, merchant.id);
    const results = await Promise.allSettled([
      review.approve({ merchantId: merchant.id, adminId: ADMIN_ID }),
      review.reject({ merchantId: merchant.id, adminId: ADMIN_ID }),
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
});
