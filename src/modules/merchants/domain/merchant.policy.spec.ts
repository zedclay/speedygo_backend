import {
  MERCHANT_CAPABILITIES,
  MERCHANT_MEMBER_ROLE_MANAGER,
  MERCHANT_MEMBER_ROLE_OWNER,
  MERCHANT_MEMBER_ROLE_STAFF,
  MERCHANT_STATUS_ACTIVE,
  MERCHANT_STATUS_PENDING_REVIEW,
  MERCHANT_STATUS_REJECTED,
  MERCHANT_STATUS_SUSPENDED,
  deriveMerchantReadiness,
  parseMerchantMemberRole,
  parseMerchantStatus,
  roleHasCapability,
  statusAllowsBranchMutation,
  statusAllowsProfileUpdate,
} from './merchant.policy';

describe('Merchant policy', () => {
  it('parses known roles and fails closed for unknown roles', () => {
    expect(parseMerchantMemberRole('OWNER')).toBe(MERCHANT_MEMBER_ROLE_OWNER);
    expect(parseMerchantMemberRole('MANAGER')).toBe(
      MERCHANT_MEMBER_ROLE_MANAGER,
    );
    expect(parseMerchantMemberRole('STAFF')).toBe(MERCHANT_MEMBER_ROLE_STAFF);
    expect(parseMerchantMemberRole('CREATOR')).toBeNull();
    expect(parseMerchantMemberRole('ADMIN')).toBeNull();
    expect(parseMerchantMemberRole('')).toBeNull();
  });

  it('does not grant OWNER or MANAGER capabilities to unknown roles', () => {
    const unknown = parseMerchantMemberRole('CREATOR');
    expect(unknown).toBeNull();
  });

  it('grants OWNER profile and branch capabilities', () => {
    expect(
      roleHasCapability(
        MERCHANT_MEMBER_ROLE_OWNER,
        MERCHANT_CAPABILITIES.MERCHANT_PROFILE_UPDATE,
      ),
    ).toBe(true);
    expect(
      roleHasCapability(
        MERCHANT_MEMBER_ROLE_OWNER,
        MERCHANT_CAPABILITIES.MERCHANT_BRANCH_CREATE,
      ),
    ).toBe(true);
  });

  it('grants MANAGER branch capabilities but not profile update', () => {
    expect(
      roleHasCapability(
        MERCHANT_MEMBER_ROLE_MANAGER,
        MERCHANT_CAPABILITIES.MERCHANT_PROFILE_UPDATE,
      ),
    ).toBe(false);
    expect(
      roleHasCapability(
        MERCHANT_MEMBER_ROLE_MANAGER,
        MERCHANT_CAPABILITIES.MERCHANT_BRANCH_UPDATE,
      ),
    ).toBe(true);
  });

  it('grants STAFF catalog read only', () => {
    expect(
      roleHasCapability(
        MERCHANT_MEMBER_ROLE_STAFF,
        MERCHANT_CAPABILITIES.CATALOG_READ,
      ),
    ).toBe(true);
    expect(
      roleHasCapability(
        MERCHANT_MEMBER_ROLE_STAFF,
        MERCHANT_CAPABILITIES.CATEGORY_MANAGE,
      ),
    ).toBe(false);
    expect(
      roleHasCapability(
        MERCHANT_MEMBER_ROLE_STAFF,
        MERCHANT_CAPABILITIES.PRODUCT_MANAGE,
      ),
    ).toBe(false);
    expect(
      roleHasCapability(
        MERCHANT_MEMBER_ROLE_STAFF,
        MERCHANT_CAPABILITIES.ORDER_READ,
      ),
    ).toBe(true);
    expect(
      roleHasCapability(
        MERCHANT_MEMBER_ROLE_STAFF,
        MERCHANT_CAPABILITIES.ORDER_WORKFLOW_MUTATE,
      ),
    ).toBe(false);
  });

  it('grants OWNER and MANAGER settlement read and STAFF Order read only', () => {
    expect(
      roleHasCapability(
        MERCHANT_MEMBER_ROLE_OWNER,
        MERCHANT_CAPABILITIES.SETTLEMENT_READ,
      ),
    ).toBe(true);
    expect(
      roleHasCapability(
        MERCHANT_MEMBER_ROLE_MANAGER,
        MERCHANT_CAPABILITIES.SETTLEMENT_READ,
      ),
    ).toBe(true);
    expect(
      roleHasCapability(
        MERCHANT_MEMBER_ROLE_STAFF,
        MERCHANT_CAPABILITIES.SETTLEMENT_READ,
      ),
    ).toBe(false);
  });

  it('grants OWNER and MANAGER Order workflow mutation and STAFF Order read only', () => {
    expect(
      roleHasCapability(
        MERCHANT_MEMBER_ROLE_OWNER,
        MERCHANT_CAPABILITIES.ORDER_WORKFLOW_MUTATE,
      ),
    ).toBe(true);
    expect(
      roleHasCapability(
        MERCHANT_MEMBER_ROLE_MANAGER,
        MERCHANT_CAPABILITIES.ORDER_WORKFLOW_MUTATE,
      ),
    ).toBe(true);
    expect(
      roleHasCapability(
        MERCHANT_MEMBER_ROLE_STAFF,
        MERCHANT_CAPABILITIES.ORDER_WORKFLOW_MUTATE,
      ),
    ).toBe(false);
    expect(
      roleHasCapability(
        MERCHANT_MEMBER_ROLE_OWNER,
        MERCHANT_CAPABILITIES.COMMISSION_READ,
      ),
    ).toBe(true);
    expect(
      roleHasCapability(
        MERCHANT_MEMBER_ROLE_MANAGER,
        MERCHANT_CAPABILITIES.COMMISSION_READ,
      ),
    ).toBe(true);
    expect(
      roleHasCapability(
        MERCHANT_MEMBER_ROLE_STAFF,
        MERCHANT_CAPABILITIES.COMMISSION_READ,
      ),
    ).toBe(false);
  });

  it('grants OWNER and MANAGER catalog mutation capabilities', () => {
    expect(
      roleHasCapability(
        MERCHANT_MEMBER_ROLE_OWNER,
        MERCHANT_CAPABILITIES.PRODUCT_OPTIONS_MANAGE,
      ),
    ).toBe(true);
    expect(
      roleHasCapability(
        MERCHANT_MEMBER_ROLE_MANAGER,
        MERCHANT_CAPABILITIES.CATEGORY_MANAGE,
      ),
    ).toBe(true);
  });

  it('grants STAFF merchant read only', () => {
    expect(
      roleHasCapability(
        MERCHANT_MEMBER_ROLE_STAFF,
        MERCHANT_CAPABILITIES.MERCHANT_READ,
      ),
    ).toBe(true);
    expect(
      roleHasCapability(
        MERCHANT_MEMBER_ROLE_STAFF,
        MERCHANT_CAPABILITIES.MERCHANT_PROFILE_UPDATE,
      ),
    ).toBe(false);
    expect(
      roleHasCapability(
        MERCHANT_MEMBER_ROLE_STAFF,
        MERCHANT_CAPABILITIES.MERCHANT_BRANCH_DELETE,
      ),
    ).toBe(false);
  });

  it('parses known statuses and fails closed for unknown statuses', () => {
    expect(parseMerchantStatus('PENDING_REVIEW')).toBe(
      MERCHANT_STATUS_PENDING_REVIEW,
    );
    expect(parseMerchantStatus('ACTIVE')).toBe(MERCHANT_STATUS_ACTIVE);
    expect(parseMerchantStatus('REJECTED')).toBe(MERCHANT_STATUS_REJECTED);
    expect(parseMerchantStatus('SUSPENDED')).toBe(MERCHANT_STATUS_SUSPENDED);
    expect(parseMerchantStatus('ARCHIVED')).toBeNull();
    expect(parseMerchantStatus('')).toBeNull();
  });

  it('allows profile updates only for PENDING_REVIEW and REJECTED', () => {
    expect(statusAllowsProfileUpdate(MERCHANT_STATUS_PENDING_REVIEW)).toBe(
      true,
    );
    expect(statusAllowsProfileUpdate(MERCHANT_STATUS_REJECTED)).toBe(true);
    expect(statusAllowsProfileUpdate(MERCHANT_STATUS_ACTIVE)).toBe(false);
    expect(statusAllowsProfileUpdate(MERCHANT_STATUS_SUSPENDED)).toBe(false);
  });

  it('blocks branch mutation for SUSPENDED', () => {
    expect(statusAllowsBranchMutation(MERCHANT_STATUS_PENDING_REVIEW)).toBe(
      true,
    );
    expect(statusAllowsBranchMutation(MERCHANT_STATUS_ACTIVE)).toBe(true);
    expect(statusAllowsBranchMutation(MERCHANT_STATUS_SUSPENDED)).toBe(false);
  });

  it('never marks PENDING_REVIEW as operationalReady', () => {
    const readiness = deriveMerchantReadiness({
      name: 'Cafe',
      status: MERCHANT_STATUS_PENDING_REVIEW,
      verifiedAt: null,
      branchOperationalStatuses: ['ACTIVE'],
    });
    expect(readiness.profileComplete).toBe(true);
    expect(readiness.hasBranch).toBe(true);
    expect(readiness.branchReady).toBe(true);
    expect(readiness.approved).toBe(false);
    expect(readiness.operationalReady).toBe(false);
  });

  it('marks ACTIVE + verifiedAt + ACTIVE Branch as operationalReady', () => {
    const readiness = deriveMerchantReadiness({
      name: 'Cafe',
      status: MERCHANT_STATUS_ACTIVE,
      verifiedAt: '2026-09-01T00:00:00.000Z',
      branchOperationalStatuses: ['ACTIVE'],
    });
    expect(readiness.approved).toBe(true);
    expect(readiness.operationalReady).toBe(true);
  });

  it('is not operationalReady when ACTIVE without a Branch', () => {
    const readiness = deriveMerchantReadiness({
      name: 'Cafe',
      status: MERCHANT_STATUS_ACTIVE,
      verifiedAt: '2026-09-01T00:00:00.000Z',
      branchOperationalStatuses: [],
    });
    expect(readiness.hasBranch).toBe(false);
    expect(readiness.branchReady).toBe(false);
    expect(readiness.operationalReady).toBe(false);
  });

  it('is not operationalReady when ACTIVE with only INACTIVE or SUSPENDED Branches', () => {
    expect(
      deriveMerchantReadiness({
        name: 'Cafe',
        status: MERCHANT_STATUS_ACTIVE,
        verifiedAt: '2026-09-01T00:00:00.000Z',
        branchOperationalStatuses: ['INACTIVE', 'SUSPENDED'],
      }).operationalReady,
    ).toBe(false);
  });

  it('never marks SUSPENDED as operationalReady', () => {
    expect(
      deriveMerchantReadiness({
        name: 'Cafe',
        status: MERCHANT_STATUS_SUSPENDED,
        verifiedAt: '2026-09-01T00:00:00.000Z',
        branchOperationalStatuses: ['ACTIVE'],
      }).operationalReady,
    ).toBe(false);
  });

  it('does not treat unknown status as approved or operational', () => {
    const readiness = deriveMerchantReadiness({
      name: 'Cafe',
      status: 'WEIRD',
      verifiedAt: '2026-09-01T00:00:00.000Z',
      branchOperationalStatuses: ['ACTIVE'],
    });
    expect(readiness.approved).toBe(false);
    expect(readiness.operationalReady).toBe(false);
  });
});
