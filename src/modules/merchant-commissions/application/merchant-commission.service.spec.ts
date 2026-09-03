import { MerchantCommissionService } from './merchant-commission.service';
import { MERCHANT_COMMISSION_ERROR_CODES } from '../domain/merchant-commission.errors';
import type { MerchantCommissionRuleRecord } from '../domain/merchant-commission.types';

const ADMIN = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const MERCHANT_A = '11111111-1111-7111-8111-111111111111';
const MERCHANT_B = '22222222-2222-7222-8222-222222222222';
const ACCOUNT = '33333333-3333-7333-8333-333333333333';

describe('MerchantCommissionService', () => {
  let rules: MerchantCommissionRuleRecord[];
  let repo: {
    runInTransaction: jest.Mock;
    listActiveCandidateRules: jest.Mock;
    listActiveRulesByScope: jest.Mock;
    findById: jest.Mock;
    createRule: jest.Mock;
    deactivateRule: jest.Mock;
  };
  let access: { requireCapability: jest.Mock };
  let service: MerchantCommissionService;

  beforeEach(() => {
    rules = [
      {
        id: 'global-1',
        scope: 'GLOBAL_DEFAULT',
        merchantId: null,
        rateBps: 700,
        effectiveFrom: '2020-01-01T00:00:00.000Z',
        effectiveTo: null,
        active: true,
      },
    ];
    repo = {
      runInTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      lockConfigurationScope: jest.fn().mockResolvedValue(undefined),
      readCommissionDecisionAt: jest
        .fn()
        .mockResolvedValue(new Date('2026-06-01T00:00:00.000Z')),
      listActiveCandidateRules: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve(rules.filter((row) => row.active)),
        ),
      listActiveRulesByScope: jest
        .fn()
        .mockImplementation(
          (input: { scope: string; merchantId: string | null }) =>
            Promise.resolve(
              rules.filter(
                (row) =>
                  row.active &&
                  row.scope === input.scope &&
                  row.merchantId === input.merchantId,
              ),
            ),
        ),
      findById: jest
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(rules.find((row) => row.id === id) ?? null),
        ),
      createRule: jest
        .fn()
        .mockImplementation((input: MerchantCommissionRuleRecord) => {
          const created = {
            id: input.id ?? `rule-${rules.length + 1}`,
            scope: input.scope,
            merchantId: input.merchantId,
            rateBps: input.rateBps,
            effectiveFrom: input.effectiveFrom,
            effectiveTo: input.effectiveTo,
            active: true,
          };
          rules.push(created);
          return Promise.resolve(created);
        }),
      deactivateRule: jest.fn().mockImplementation((id: string) => {
        const row = rules.find((item) => item.id === id);
        if (row) {
          row.active = false;
        }
        return Promise.resolve(row ?? null);
      }),
    };
    access = {
      requireCapability: jest.fn().mockResolvedValue({}),
    };
    service = new MerchantCommissionService(repo as never, access as never, {
      now: () => new Date('2026-06-01T00:00:00.000Z'),
    });
  });

  it('resolves override for Merchant A and global default for Merchant B', async () => {
    rules.push({
      id: 'override-a',
      scope: 'MERCHANT_OVERRIDE',
      merchantId: MERCHANT_A,
      rateBps: 400,
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      effectiveTo: null,
      active: true,
    });
    const forA = await service.resolveApplicable(
      MERCHANT_A,
      new Date('2026-06-01T00:00:00.000Z'),
    );
    const forB = await service.resolveApplicable(
      MERCHANT_B,
      new Date('2026-06-01T00:00:00.000Z'),
    );
    expect(forA.rateBps).toBe(400);
    expect(forB.rateBps).toBe(700);
  });

  it('keeps historical snapshot math when a future rule is created after deactivation', async () => {
    const first = await service.resolveApplicable(
      MERCHANT_A,
      new Date('2026-06-01T00:00:00.000Z'),
    );
    expect(first.rateBps).toBe(700);
    await service.deactivateRule('global-1');
    await service.createRule({
      scope: 'GLOBAL_DEFAULT',
      rateBps: 1000,
      changedByAdminId: ADMIN,
      effectiveFrom: '2026-06-01T00:00:00.000Z',
    });
    const second = await service.resolveApplicable(
      MERCHANT_A,
      new Date('2026-06-02T00:00:00.000Z'),
    );
    expect(first.rateBps).toBe(700);
    expect(second.rateBps).toBe(1000);
  });

  it('falls back to global default after override deactivation', async () => {
    rules.push({
      id: 'override-a',
      scope: 'MERCHANT_OVERRIDE',
      merchantId: MERCHANT_A,
      rateBps: 250,
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      effectiveTo: null,
      active: true,
    });
    expect(
      (
        await service.resolveApplicable(
          MERCHANT_A,
          new Date('2026-06-01T00:00:00.000Z'),
        )
      ).rateBps,
    ).toBe(250);
    await service.deactivateRule('override-a');
    expect(
      (
        await service.resolveApplicable(
          MERCHANT_A,
          new Date('2026-06-01T00:00:00.000Z'),
        )
      ).rateBps,
    ).toBe(700);
  });

  it('rejects overlapping active global defaults on create', async () => {
    await expect(
      service.createRule({
        scope: 'GLOBAL_DEFAULT',
        rateBps: 500,
        changedByAdminId: ADMIN,
      }),
    ).rejects.toMatchObject({
      code: MERCHANT_COMMISSION_ERROR_CODES.MERCHANT_COMMISSION_CONFIGURATION_INVALID,
    });
    expect(repo.lockConfigurationScope).toHaveBeenCalled();
  });

  it('acquires the configuration lock before create and deactivate', async () => {
    await service.deactivateRule('global-1');
    expect(repo.lockConfigurationScope).toHaveBeenCalledWith(
      'GLOBAL_DEFAULT',
      null,
      expect.anything(),
    );
    await service.createRule({
      scope: 'GLOBAL_DEFAULT',
      rateBps: 1000,
      changedByAdminId: ADMIN,
      effectiveFrom: '2026-06-01T00:00:00.000Z',
    });
    expect(repo.lockConfigurationScope).toHaveBeenCalled();
    expect(repo.readCommissionDecisionAt).toHaveBeenCalled();
  });

  it('rejects invalid rates on create', async () => {
    await expect(
      service.createRule({
        scope: 'GLOBAL_DEFAULT',
        rateBps: 10001,
        changedByAdminId: ADMIN,
      }),
    ).rejects.toMatchObject({
      code: MERCHANT_COMMISSION_ERROR_CODES.MERCHANT_COMMISSION_RATE_INVALID,
    });
  });

  it('returns a coherent rule under concurrent resolve after deactivation', async () => {
    const instant = new Date('2026-06-01T00:00:00.000Z');
    const [left, right] = await Promise.all([
      service.resolveApplicable(MERCHANT_A, instant),
      service.resolveApplicable(MERCHANT_A, instant),
    ]);
    expect(left.rateBps).toBe(right.rateBps);
    expect(left.ruleId).toBe(right.ruleId);
  });

  it('reads the effective Merchant rule after access check', async () => {
    const view = await service.getMerchantEffectiveCommission(
      ACCOUNT,
      MERCHANT_A,
    );
    expect(view.rateBps).toBe(700);
    expect(view.scope).toBe('GLOBAL_DEFAULT');
    expect(access.requireCapability).toHaveBeenCalled();
  });
});
