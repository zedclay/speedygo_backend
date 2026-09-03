import { Inject, Injectable } from '@nestjs/common';
import {
  CHECKOUT_CLOCK,
  type CheckoutClock,
} from '../../checkout/domain/checkout.clock';
import { MerchantAccessService } from '../../merchants/application/merchant-access.service';
import { MERCHANT_CAPABILITIES } from '../../merchants/domain/merchant.policy';
import {
  merchantCommissionConfigurationInvalid,
  merchantCommissionRuleNotFound,
} from '../domain/merchant-commission.errors';
import {
  calculateMerchantCommission,
  commissionWindowsOverlap,
  requireCommissionRateBps,
  requireSelectedRuleStillValid,
  requireValidCommissionScopeMerchant,
  selectApplicableMerchantCommissionRule,
} from '../domain/merchant-commission.policy';
import type {
  MerchantCommissionCalculation,
  MerchantEffectiveCommissionView,
  ResolvedMerchantCommissionRule,
} from '../domain/merchant-commission.types';
import {
  MerchantCommissionRepository,
  type OrmClient,
} from '../infrastructure/merchant-commission.repository';

export type CreateMerchantCommissionRuleInput = {
  scope: string;
  merchantId?: string | null;
  rateBps: number;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  changeReason?: string | null;
  changedByAdminId: string;
};

@Injectable()
export class MerchantCommissionService {
  constructor(
    private readonly rules: MerchantCommissionRepository,
    private readonly access: MerchantAccessService,
    @Inject(CHECKOUT_CLOCK) private readonly clock: CheckoutClock,
  ) {}

  calculate(input: {
    commissionBaseMinor: number;
    rateBps: number;
  }): MerchantCommissionCalculation {
    return calculateMerchantCommission(input);
  }

  /**
   * Authoritative Order-creation decision instant: one PostgreSQL
   * `clock_timestamp()` read inside the Order transaction.
   */
  async readCommissionDecisionAt(client: OrmClient): Promise<Date> {
    return this.rules.readCommissionDecisionAt(client);
  }

  async resolveApplicable(
    merchantId: string,
    commissionDecisionAt: Date,
    client?: OrmClient,
  ): Promise<ResolvedMerchantCommissionRule> {
    const candidates = await this.rules.listActiveCandidateRules(
      merchantId,
      client,
    );
    const selected = selectApplicableMerchantCommissionRule(
      candidates,
      merchantId,
      commissionDecisionAt,
    );
    const locked = await this.rules.findById(selected.ruleId, client);
    return requireSelectedRuleStillValid({
      selected,
      locked,
      orderMerchantId: merchantId,
      commissionDecisionAt,
    });
  }

  async getMerchantEffectiveCommission(
    accountId: string,
    merchantId: string,
  ): Promise<MerchantEffectiveCommissionView> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.COMMISSION_READ,
    );
    const instant = this.clock.now();
    const resolved = await this.resolveApplicable(merchantId, instant);
    const rule = await this.rules.findById(resolved.ruleId);
    if (!rule) {
      throw merchantCommissionRuleNotFound();
    }
    return {
      merchantId,
      scope: resolved.scope,
      rateBps: resolved.rateBps,
      ruleId: resolved.ruleId,
      effectiveFrom: rule.effectiveFrom,
      effectiveTo: rule.effectiveTo,
    };
  }

  /**
   * Trusted internal platform authority. Not a public Admin HTTP endpoint.
   * Appends a new future-applicable row under a per-scope advisory lock.
   * Does not mutate rateBps on historical rows. Does not rewrite Order snapshots.
   */
  async createRule(input: CreateMerchantCommissionRuleInput) {
    const merchantId = input.merchantId ?? null;
    const scope = requireValidCommissionScopeMerchant({
      scope: input.scope,
      merchantId,
    });
    requireCommissionRateBps(input.rateBps);
    if (input.effectiveFrom !== undefined) {
      this.assertEffectiveRange(input.effectiveFrom, input.effectiveTo ?? null);
    }

    return this.rules.runInTransaction(async (tx) => {
      await this.rules.lockConfigurationScope(scope, merchantId, tx);
      const decisionAt = await this.rules.readCommissionDecisionAt(tx);
      const effectiveFrom = input.effectiveFrom ?? decisionAt.toISOString();
      const effectiveTo = input.effectiveTo ?? null;
      this.assertEffectiveRange(effectiveFrom, effectiveTo);

      const existing = await this.rules.listActiveRulesByScope({
        scope,
        merchantId,
        client: tx,
      });
      const overlapping = existing.filter((rule) =>
        commissionWindowsOverlap(rule, { effectiveFrom, effectiveTo }),
      );
      if (overlapping.length > 0) {
        throw merchantCommissionConfigurationInvalid(
          'An overlapping active commission rule already exists for this scope',
        );
      }
      return this.rules.createRule(
        {
          scope,
          merchantId,
          rateBps: input.rateBps,
          effectiveFrom,
          effectiveTo,
          changeReason: input.changeReason ?? null,
          changedByAdminId: input.changedByAdminId,
        },
        tx,
      );
    });
  }

  /**
   * Trusted internal platform authority. Future resolution only.
   * Uses the same logical configuration lock as createRule.
   */
  async deactivateRule(ruleId: string) {
    return this.rules.runInTransaction(async (tx) => {
      const existing = await this.rules.findById(ruleId, tx);
      if (!existing) {
        throw merchantCommissionRuleNotFound();
      }
      const scope = requireValidCommissionScopeMerchant({
        scope: existing.scope,
        merchantId: existing.merchantId,
      });
      await this.rules.lockConfigurationScope(scope, existing.merchantId, tx);
      const locked = await this.rules.findById(ruleId, tx);
      if (!locked) {
        throw merchantCommissionRuleNotFound();
      }
      if (!locked.active) {
        return locked;
      }
      const decisionAt = await this.rules.readCommissionDecisionAt(tx);
      const nowIso = decisionAt.toISOString();
      const fromMs = Date.parse(locked.effectiveFrom);
      const nowMs = decisionAt.getTime();
      const canCloseWindow =
        Number.isFinite(fromMs) && Number.isFinite(nowMs) && nowMs > fromMs;
      return this.rules.deactivateRule(
        ruleId,
        canCloseWindow ? nowIso : null,
        tx,
      );
    });
  }

  private assertEffectiveRange(
    effectiveFrom: string,
    effectiveTo: string | null,
  ): void {
    const from = Date.parse(effectiveFrom);
    if (!Number.isFinite(from)) {
      throw merchantCommissionConfigurationInvalid(
        'effectiveFrom must be a valid timestamp',
      );
    }
    if (!effectiveTo) {
      return;
    }
    const to = Date.parse(effectiveTo);
    if (!Number.isFinite(to) || to <= from) {
      throw merchantCommissionConfigurationInvalid(
        'effectiveTo must be after effectiveFrom',
      );
    }
  }
}
