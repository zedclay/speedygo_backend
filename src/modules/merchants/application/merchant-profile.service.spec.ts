import { ConfigService } from '@nestjs/config';
import {
  merchantLastBranchRequired,
  merchantStatusRestricted,
  MERCHANT_ERROR_CODES,
} from '../domain/merchant.errors';
import {
  parseMerchantStatus,
  statusAllowsBranchMutation,
} from '../domain/merchant.policy';
import {
  MERCHANT_BRANCH_OPERATIONAL_STATUS_ACTIVE,
  MERCHANT_MEMBER_ROLE_MANAGER,
  MERCHANT_MEMBER_ROLE_OWNER,
  MERCHANT_MEMBER_ROLE_STAFF,
  MERCHANT_STATUS_ACTIVE,
  MERCHANT_STATUS_PENDING_REVIEW,
  MERCHANT_STATUS_REJECTED,
  MERCHANT_STATUS_SUSPENDED,
  type CreateBranchInput,
  type CreateMerchantInput,
  type MerchantBranchRecord,
  type MerchantDocumentSummary,
  type MerchantMemberRecord,
  type MerchantRecord,
  type UpdateBranchInput,
  type UpdateMerchantInput,
} from '../domain/merchant.types';
import { MerchantAccessService } from './merchant-access.service';
import { MerchantBranchService } from './merchant-branch.service';
import { MerchantProfileService } from './merchant-profile.service';

const ACCOUNT_A = '11111111-1111-7111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-7222-8222-222222222222';
const ACCOUNT_MANAGER = '33333333-3333-7333-8333-333333333333';
const ACCOUNT_STAFF = '44444444-4444-7444-8444-444444444444';
const ACCOUNT_UNKNOWN = '55555555-5555-7555-8555-555555555555';
const FOREIGN_MERCHANT = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';

function now(): string {
  return new Date().toISOString();
}

const BRANCH_INPUT = {
  name: 'Main',
  phone: '0550123456',
  addressText: 'Street 1',
  latitude: 36.75,
  longitude: 3.05,
};

class MemoryMerchantRepository {
  merchants = new Map<string, MerchantRecord>();
  members: MerchantMemberRecord[] = [];
  branches = new Map<string, MerchantBranchRecord[]>();
  documents = new Map<string, MerchantDocumentSummary[]>();
  private locks = new Map<string, Promise<unknown>>();

  listMembershipsByAccountId(
    accountId: string,
  ): Promise<MerchantMemberRecord[]> {
    return Promise.resolve(
      this.members
        .filter((row) => row.accountId === accountId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
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

  findMerchantsByIds(ids: string[]): Promise<MerchantRecord[]> {
    return Promise.resolve(
      ids.flatMap((id) => {
        const merchant = this.merchants.get(id);
        return merchant ? [merchant] : [];
      }),
    );
  }

  listBranchesByMerchantIds(
    merchantIds: string[],
  ): Promise<MerchantBranchRecord[]> {
    return Promise.resolve(
      merchantIds.flatMap((id) => this.branches.get(id) ?? []),
    );
  }

  listDocumentSummariesByMerchantIds(
    merchantIds: string[],
  ): Promise<MerchantDocumentSummary[]> {
    return Promise.resolve(
      merchantIds.flatMap((id) => this.documents.get(id) ?? []),
    );
  }

  createMerchantWithOwner(
    accountId: string,
    input: CreateMerchantInput,
  ): Promise<{ merchant: MerchantRecord; member: MerchantMemberRecord }> {
    const merchant: MerchantRecord = {
      id: `merchant-${this.merchants.size + 1}-${accountId.slice(0, 8)}`,
      publicReference: `sgm_${this.merchants.size + 1}`,
      name: input.name,
      status: MERCHANT_STATUS_PENDING_REVIEW,
      verifiedAt: null,
      createdAt: now(),
      updatedAt: now(),
    };
    const member: MerchantMemberRecord = {
      id: `member-${merchant.id}`,
      merchantId: merchant.id,
      accountId,
      role: MERCHANT_MEMBER_ROLE_OWNER,
      createdAt: now(),
    };
    this.merchants.set(merchant.id, merchant);
    this.members.push(member);
    this.branches.set(merchant.id, []);
    this.documents.set(merchant.id, []);
    return Promise.resolve({ merchant, member });
  }

  addMember(
    merchantId: string,
    accountId: string,
    role: string,
  ): MerchantMemberRecord {
    const member: MerchantMemberRecord = {
      id: `member-${accountId}-${merchantId}`,
      merchantId,
      accountId,
      role,
      createdAt: now(),
    };
    this.members.push(member);
    return member;
  }

  setMerchantState(
    merchantId: string,
    patch: Partial<Pick<MerchantRecord, 'status' | 'verifiedAt' | 'name'>>,
  ): void {
    const merchant = this.merchants.get(merchantId);
    if (!merchant) {
      throw new Error('missing merchant');
    }
    this.merchants.set(merchantId, { ...merchant, ...patch, updatedAt: now() });
  }

  setBranchOperationalStatus(
    merchantId: string,
    branchId: string,
    operationalStatus: string,
  ): void {
    const branch = this.branches
      .get(merchantId)
      ?.find((row) => row.id === branchId);
    if (!branch) {
      throw new Error('missing branch');
    }
    branch.operationalStatus = operationalStatus;
  }

  updateMerchant(
    merchantId: string,
    input: UpdateMerchantInput,
  ): Promise<MerchantRecord | null> {
    const merchant = this.merchants.get(merchantId);
    if (!merchant) {
      return Promise.resolve(null);
    }
    const next = {
      ...merchant,
      name: input.name ?? merchant.name,
      updatedAt: now(),
    };
    this.merchants.set(merchantId, next);
    return Promise.resolve(next);
  }

  listBranches(merchantId: string): Promise<MerchantBranchRecord[]> {
    return Promise.resolve(
      [...(this.branches.get(merchantId) ?? [])].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      ),
    );
  }

  findOwnedBranch(
    merchantId: string,
    branchId: string,
  ): Promise<MerchantBranchRecord | null> {
    return Promise.resolve(
      this.branches.get(merchantId)?.find((row) => row.id === branchId) ?? null,
    );
  }

  createBranch(
    merchantId: string,
    input: CreateBranchInput,
  ): Promise<MerchantBranchRecord> {
    const list = this.branches.get(merchantId) ?? [];
    const row: MerchantBranchRecord = {
      id: `branch-${list.length + 1}-${merchantId.slice(0, 8)}`,
      merchantId,
      name: input.name,
      phone: input.phone,
      addressText: input.addressText,
      latitude: input.latitude,
      longitude: input.longitude,
      operationalStatus: MERCHANT_BRANCH_OPERATIONAL_STATUS_ACTIVE,
      createdAt: now(),
      updatedAt: now(),
    };
    list.push(row);
    this.branches.set(merchantId, list);
    return Promise.resolve(row);
  }

  updateBranch(
    merchantId: string,
    branchId: string,
    input: UpdateBranchInput,
  ): Promise<MerchantBranchRecord | null> {
    const list = this.branches.get(merchantId) ?? [];
    const row = list.find((item) => item.id === branchId);
    if (!row) {
      return Promise.resolve(null);
    }
    if (input.name !== undefined) {
      row.name = input.name;
    }
    if (input.phone !== undefined) {
      row.phone = input.phone;
    }
    if (input.addressText !== undefined) {
      row.addressText = input.addressText;
    }
    if (input.latitude !== undefined) {
      row.latitude = input.latitude;
    }
    if (input.longitude !== undefined) {
      row.longitude = input.longitude;
    }
    row.updatedAt = now();
    return Promise.resolve(row);
  }

  deleteBranch(merchantId: string, branchId: string): Promise<boolean> {
    return this.deleteBranchGuarded(merchantId, branchId);
  }

  async deleteBranchGuarded(
    merchantId: string,
    branchId: string,
  ): Promise<boolean> {
    return this.serialize(merchantId, () => {
      const merchant = this.merchants.get(merchantId);
      if (!merchant) {
        return Promise.resolve(false);
      }
      const list = this.branches.get(merchantId) ?? [];
      if (!list.some((item) => item.id === branchId)) {
        return Promise.resolve(false);
      }
      const status = parseMerchantStatus(merchant.status);
      if (!status || !statusAllowsBranchMutation(status)) {
        throw merchantStatusRestricted(
          'Branches cannot be changed in the current Merchant status',
        );
      }
      if (status === MERCHANT_STATUS_ACTIVE && list.length <= 1) {
        throw merchantLastBranchRequired();
      }
      this.branches.set(
        merchantId,
        list.filter((item) => item.id !== branchId),
      );
      return Promise.resolve(true);
    });
  }

  listDocumentSummaries(
    merchantId: string,
  ): Promise<MerchantDocumentSummary[]> {
    return Promise.resolve(this.documents.get(merchantId) ?? []);
  }

  private serialize<T>(merchantId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(merchantId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = previous.then(() => gate);
    this.locks.set(
      merchantId,
      current.catch(() => undefined),
    );
    return previous
      .catch(() => undefined)
      .then(work)
      .finally(() => {
        release();
      });
  }
}

function config(): ConfigService {
  return {
    get: (key: string, fallback?: unknown) =>
      key === 'auth.defaultCountry' ? 'DZ' : fallback,
  } as ConfigService;
}

describe('Merchant foundation services', () => {
  let repo: MemoryMerchantRepository;
  let access: MerchantAccessService;
  let profiles: MerchantProfileService;
  let branches: MerchantBranchService;

  beforeEach(() => {
    repo = new MemoryMerchantRepository();
    access = new MerchantAccessService(repo as never);
    profiles = new MerchantProfileService(repo as never, access);
    branches = new MerchantBranchService(repo as never, access, config());
  });

  it('returns empty bootstrap state when membership is absent', async () => {
    const me = await profiles.getMe(ACCOUNT_A);
    expect(me).toEqual({
      merchantMembershipExists: false,
      memberships: [],
    });
  });

  it('creates a merchant as PENDING_REVIEW with OWNER membership and null verifiedAt', async () => {
    const created = await profiles.create(ACCOUNT_A, { name: 'Cafe A' });
    expect(created.role).toBe(MERCHANT_MEMBER_ROLE_OWNER);
    expect(created.merchant.name).toBe('Cafe A');
    expect(created.merchant.status).toBe(MERCHANT_STATUS_PENDING_REVIEW);
    expect(created.merchant.verifiedAt).toBeNull();
    expect(created.profileComplete).toBe(true);
    expect(created.hasBranch).toBe(false);
    expect(created.branchReady).toBe(false);
    expect(created.approved).toBe(false);
    expect(created.operationalReady).toBe(false);
    const me = await profiles.getMe(ACCOUNT_A);
    expect(me.merchantMembershipExists).toBe(true);
    expect(me.memberships).toHaveLength(1);
  });

  it('allows the same account to create more than one merchant', async () => {
    await profiles.create(ACCOUNT_A, { name: 'One' });
    await profiles.create(ACCOUNT_A, { name: 'Two' });
    const me = await profiles.getMe(ACCOUNT_A);
    expect(me.memberships).toHaveLength(2);
  });

  it('lets OWNER update profile while PENDING_REVIEW', async () => {
    const created = await profiles.create(ACCOUNT_A, { name: 'Cafe A' });
    const updated = await profiles.update(ACCOUNT_A, created.merchantId, {
      name: 'Cafe A Updated',
    });
    expect(updated.merchant.name).toBe('Cafe A Updated');
    expect(updated.merchant.status).toBe(MERCHANT_STATUS_PENDING_REVIEW);
    expect(updated.merchant.verifiedAt).toBeNull();
  });

  it('lets OWNER correct profile while REJECTED', async () => {
    const created = await profiles.create(ACCOUNT_A, { name: 'Cafe A' });
    repo.setMerchantState(created.merchantId, {
      status: MERCHANT_STATUS_REJECTED,
    });
    const updated = await profiles.update(ACCOUNT_A, created.merchantId, {
      name: 'Corrected',
    });
    expect(updated.merchant.name).toBe('Corrected');
  });

  it('denies MANAGER profile update', async () => {
    const created = await profiles.create(ACCOUNT_A, { name: 'Cafe A' });
    repo.addMember(
      created.merchantId,
      ACCOUNT_MANAGER,
      MERCHANT_MEMBER_ROLE_MANAGER,
    );
    await expect(
      profiles.update(ACCOUNT_MANAGER, created.merchantId, { name: 'Nope' }),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
    });
  });

  it('denies STAFF profile update', async () => {
    const created = await profiles.create(ACCOUNT_A, { name: 'Cafe A' });
    repo.addMember(
      created.merchantId,
      ACCOUNT_STAFF,
      MERCHANT_MEMBER_ROLE_STAFF,
    );
    await expect(
      profiles.update(ACCOUNT_STAFF, created.merchantId, { name: 'Nope' }),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
    });
  });

  it('rejects ACTIVE Merchant name updates', async () => {
    const created = await profiles.create(ACCOUNT_A, { name: 'Cafe A' });
    repo.setMerchantState(created.merchantId, {
      status: MERCHANT_STATUS_ACTIVE,
      verifiedAt: now(),
    });
    await expect(
      profiles.update(ACCOUNT_A, created.merchantId, { name: 'Locked' }),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_STATUS_RESTRICTED,
    });
  });

  it('rejects SUSPENDED Merchant mutations', async () => {
    const created = await profiles.create(ACCOUNT_A, { name: 'Cafe A' });
    const branch = await branches.create(
      ACCOUNT_A,
      created.merchantId,
      BRANCH_INPUT,
    );
    repo.setMerchantState(created.merchantId, {
      status: MERCHANT_STATUS_SUSPENDED,
    });
    await expect(
      profiles.update(ACCOUNT_A, created.merchantId, { name: 'Locked' }),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_STATUS_RESTRICTED,
    });
    await expect(
      branches.update(ACCOUNT_A, created.merchantId, branch.id, {
        name: 'Locked',
      }),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_STATUS_RESTRICTED,
    });
  });

  it('rejects unknown status mutations', async () => {
    const created = await profiles.create(ACCOUNT_A, { name: 'Cafe A' });
    repo.setMerchantState(created.merchantId, { status: 'WEIRD' });
    await expect(
      profiles.update(ACCOUNT_A, created.merchantId, { name: 'Nope' }),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_STATUS_RESTRICTED,
    });
    await expect(
      branches.create(ACCOUNT_A, created.merchantId, BRANCH_INPUT),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_STATUS_RESTRICTED,
    });
  });

  it('does not let account A update account B merchant', async () => {
    const owned = await profiles.create(ACCOUNT_B, { name: 'Secret' });
    await expect(
      profiles.update(ACCOUNT_A, owned.merchantId, { name: 'Hijack' }),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_NOT_FOUND,
    });
    expect(repo.merchants.get(owned.merchantId)?.name).toBe('Secret');
  });

  it('does not grant access from a missing membership even if an admin-shaped id is used', async () => {
    await expect(
      access.requireMembership(ACCOUNT_A, FOREIGN_MERCHANT),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_NOT_FOUND,
    });
  });

  it('creates, lists, updates, and deletes owned branches while PENDING_REVIEW', async () => {
    const merchant = await profiles.create(ACCOUNT_A, { name: 'Cafe A' });
    const created = await branches.create(
      ACCOUNT_A,
      merchant.merchantId,
      BRANCH_INPUT,
    );
    expect(created.phone).toBe('+213550123456');
    expect(created.operationalStatus).toBe(
      MERCHANT_BRANCH_OPERATIONAL_STATUS_ACTIVE,
    );
    const listed = await branches.list(ACCOUNT_A, merchant.merchantId);
    expect(listed.branches).toHaveLength(1);
    const updated = await branches.update(
      ACCOUNT_A,
      merchant.merchantId,
      created.id,
      { name: 'Downtown' },
    );
    expect(updated.name).toBe('Downtown');
    await branches.remove(ACCOUNT_A, merchant.merchantId, created.id);
    const after = await branches.list(ACCOUNT_A, merchant.merchantId);
    expect(after.branches).toHaveLength(0);
    const me = await profiles.getMe(ACCOUNT_A);
    expect(me.memberships[0]?.branchReady).toBe(false);
    expect(me.memberships[0]?.operationalReady).toBe(false);
  });

  it('lets MANAGER mutate branches and STAFF cannot', async () => {
    const created = await profiles.create(ACCOUNT_A, { name: 'Cafe A' });
    repo.addMember(
      created.merchantId,
      ACCOUNT_MANAGER,
      MERCHANT_MEMBER_ROLE_MANAGER,
    );
    repo.addMember(
      created.merchantId,
      ACCOUNT_STAFF,
      MERCHANT_MEMBER_ROLE_STAFF,
    );
    const branch = await branches.create(
      ACCOUNT_MANAGER,
      created.merchantId,
      BRANCH_INPUT,
    );
    const updated = await branches.update(
      ACCOUNT_MANAGER,
      created.merchantId,
      branch.id,
      { name: 'Mgr' },
    );
    expect(updated.name).toBe('Mgr');
    await expect(
      branches.create(ACCOUNT_STAFF, created.merchantId, {
        ...BRANCH_INPUT,
        name: 'Staff',
      }),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
    });
    await expect(
      branches.update(ACCOUNT_STAFF, created.merchantId, branch.id, {
        name: 'Staff',
      }),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
    });
    await expect(
      branches.remove(ACCOUNT_STAFF, created.merchantId, branch.id),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
    });
  });

  it('fails closed for unknown membership roles', async () => {
    const created = await profiles.create(ACCOUNT_A, { name: 'Cafe A' });
    repo.addMember(created.merchantId, ACCOUNT_UNKNOWN, 'CREATOR');
    await expect(
      profiles.update(ACCOUNT_UNKNOWN, created.merchantId, { name: 'Nope' }),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
    });
    await expect(
      branches.create(ACCOUNT_UNKNOWN, created.merchantId, BRANCH_INPUT),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
    });
    await expect(
      branches.list(ACCOUNT_UNKNOWN, created.merchantId),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
    });
  });

  it('cannot touch a foreign merchant branch', async () => {
    const ownedB = await profiles.create(ACCOUNT_B, { name: 'B' });
    const branchB = await branches.create(
      ACCOUNT_B,
      ownedB.merchantId,
      BRANCH_INPUT,
    );
    await profiles.create(ACCOUNT_A, { name: 'A' });
    await expect(
      branches.update(ACCOUNT_A, ownedB.merchantId, branchB.id, {
        name: 'Stolen',
      }),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_NOT_FOUND,
    });
    const ownedA = (await profiles.getMe(ACCOUNT_A)).memberships[0];
    await expect(
      branches.update(ACCOUNT_A, ownedA.merchantId, branchB.id, {
        name: 'Stolen',
      }),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_BRANCH_NOT_FOUND,
    });
  });

  it('rejects invalid coordinates and phones', async () => {
    const merchant = await profiles.create(ACCOUNT_A, { name: 'Cafe A' });
    await expect(
      branches.create(ACCOUNT_A, merchant.merchantId, {
        ...BRANCH_INPUT,
        latitude: 91,
      }),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_BRANCH_INVALID,
    });
    await expect(
      branches.create(ACCOUNT_A, merchant.merchantId, {
        ...BRANCH_INPUT,
        phone: '12',
      }),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_BRANCH_INVALID,
    });
  });

  it('allows last Branch deletion for PENDING_REVIEW and REJECTED', async () => {
    const pending = await profiles.create(ACCOUNT_A, { name: 'Pending' });
    const pendingBranch = await branches.create(
      ACCOUNT_A,
      pending.merchantId,
      BRANCH_INPUT,
    );
    await branches.remove(ACCOUNT_A, pending.merchantId, pendingBranch.id);
    expect(
      (await branches.list(ACCOUNT_A, pending.merchantId)).branches,
    ).toHaveLength(0);

    const rejected = await profiles.create(ACCOUNT_A, { name: 'Rejected' });
    repo.setMerchantState(rejected.merchantId, {
      status: MERCHANT_STATUS_REJECTED,
    });
    const rejectedBranch = await branches.create(
      ACCOUNT_A,
      rejected.merchantId,
      BRANCH_INPUT,
    );
    await branches.remove(ACCOUNT_A, rejected.merchantId, rejectedBranch.id);
    expect(
      (await branches.list(ACCOUNT_A, rejected.merchantId)).branches,
    ).toHaveLength(0);
  });

  it('rejects last Branch deletion for an ACTIVE Merchant', async () => {
    const created = await profiles.create(ACCOUNT_A, { name: 'Cafe A' });
    const branch = await branches.create(
      ACCOUNT_A,
      created.merchantId,
      BRANCH_INPUT,
    );
    repo.setMerchantState(created.merchantId, {
      status: MERCHANT_STATUS_ACTIVE,
      verifiedAt: now(),
    });
    await expect(
      branches.remove(ACCOUNT_A, created.merchantId, branch.id),
    ).rejects.toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_LAST_BRANCH_REQUIRED,
    });
  });

  it('cannot leave an ACTIVE Merchant with zero Branches under concurrent deletes', async () => {
    const created = await profiles.create(ACCOUNT_A, { name: 'Cafe A' });
    const first = await branches.create(
      ACCOUNT_A,
      created.merchantId,
      BRANCH_INPUT,
    );
    const second = await branches.create(ACCOUNT_A, created.merchantId, {
      ...BRANCH_INPUT,
      name: 'Second',
    });
    repo.setMerchantState(created.merchantId, {
      status: MERCHANT_STATUS_ACTIVE,
      verifiedAt: now(),
    });
    const results = await Promise.allSettled([
      branches.remove(ACCOUNT_A, created.merchantId, first.id),
      branches.remove(ACCOUNT_A, created.merchantId, second.id),
    ]);
    const fulfilled = results.filter((row) => row.status === 'fulfilled');
    const rejected = results.filter((row) => row.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({
      code: MERCHANT_ERROR_CODES.MERCHANT_LAST_BRANCH_REQUIRED,
    });
    expect(
      (await branches.list(ACCOUNT_A, created.merchantId)).branches,
    ).toHaveLength(1);
  });
});
