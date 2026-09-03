import { isRuleEffectiveAt } from '../../checkout/domain/checkout.policy';
import {
  merchantCommissionBaseInvalid,
  merchantCommissionConfigurationInvalid,
  merchantCommissionRateInvalid,
  merchantCommissionRuleAmbiguous,
  merchantCommissionRuleNotFound,
} from './merchant-commission.errors';
import {
  COMMISSION_SCOPE_GLOBAL_DEFAULT,
  COMMISSION_SCOPE_MERCHANT_OVERRIDE,
  type CommissionScope,
  type MerchantCommissionCalculation,
  type MerchantCommissionRuleRecord,
  type ResolvedMerchantCommissionRule,
} from './merchant-commission.types';

export const MERCHANT_COMMISSION_RATE_BPS_MIN = 0;
export const MERCHANT_COMMISSION_RATE_BPS_MAX = 10_000;

export function isCommissionRateBps(rateBps: number): boolean {
  return (
    Number.isInteger(rateBps) &&
    rateBps >= MERCHANT_COMMISSION_RATE_BPS_MIN &&
    rateBps <= MERCHANT_COMMISSION_RATE_BPS_MAX
  );
}

export function requireCommissionRateBps(rateBps: number): number {
  if (!isCommissionRateBps(rateBps)) {
    throw merchantCommissionRateInvalid();
  }
  return rateBps;
}

export function parseCommissionScope(scope: string): CommissionScope {
  if (
    scope === COMMISSION_SCOPE_GLOBAL_DEFAULT ||
    scope === COMMISSION_SCOPE_MERCHANT_OVERRIDE
  ) {
    return scope;
  }
  throw merchantCommissionConfigurationInvalid(
    'Merchant commission scope is invalid',
  );
}

export function requireValidCommissionScopeMerchant(input: {
  scope: string;
  merchantId: string | null;
}): CommissionScope {
  const scope = parseCommissionScope(input.scope);
  if (scope === COMMISSION_SCOPE_GLOBAL_DEFAULT && input.merchantId !== null) {
    throw merchantCommissionConfigurationInvalid(
      'GLOBAL_DEFAULT must not reference a Merchant',
    );
  }
  if (
    scope === COMMISSION_SCOPE_MERCHANT_OVERRIDE &&
    (input.merchantId === null || input.merchantId.length === 0)
  ) {
    throw merchantCommissionConfigurationInvalid(
      'MERCHANT_OVERRIDE must reference a Merchant',
    );
  }
  return scope;
}

/**
 * Half-open effective window FINAL:
 * active AND effectiveFrom <= commissionDecisionAt AND
 * (effectiveTo IS NULL OR commissionDecisionAt < effectiveTo)
 * i.e. [effectiveFrom, effectiveTo).
 */
export function isCommissionRuleEffectiveAt(
  rule: Pick<
    MerchantCommissionRuleRecord,
    'active' | 'effectiveFrom' | 'effectiveTo'
  >,
  instant: Date,
): boolean {
  return isRuleEffectiveAt(rule, instant);
}

/**
 * Re-validate the selected rule against the same commissionDecisionAt.
 * Fail closed — never silently swap to a different rule mid-snapshot.
 */
export function requireSelectedRuleStillValid(input: {
  selected: ResolvedMerchantCommissionRule;
  locked: MerchantCommissionRuleRecord | null;
  orderMerchantId: string;
  commissionDecisionAt: Date;
}): ResolvedMerchantCommissionRule {
  const { selected, locked, orderMerchantId, commissionDecisionAt } = input;
  if (
    !locked ||
    locked.id !== selected.ruleId ||
    locked.scope !== selected.scope ||
    locked.rateBps !== selected.rateBps ||
    locked.merchantId !== selected.merchantId ||
    !isCommissionRuleEffectiveAt(locked, commissionDecisionAt)
  ) {
    throw merchantCommissionRuleNotFound();
  }
  if (
    selected.scope === COMMISSION_SCOPE_MERCHANT_OVERRIDE &&
    selected.merchantId !== orderMerchantId
  ) {
    throw merchantCommissionRuleNotFound();
  }
  if (
    selected.scope === COMMISSION_SCOPE_GLOBAL_DEFAULT &&
    selected.merchantId !== null
  ) {
    throw merchantCommissionRuleNotFound();
  }
  return selected;
}

function windowEndMs(effectiveTo: string | null): number {
  if (!effectiveTo) {
    return Number.POSITIVE_INFINITY;
  }
  return Date.parse(effectiveTo);
}

export function commissionWindowsOverlap(
  left: Pick<MerchantCommissionRuleRecord, 'effectiveFrom' | 'effectiveTo'>,
  right: Pick<MerchantCommissionRuleRecord, 'effectiveFrom' | 'effectiveTo'>,
): boolean {
  const leftStart = Date.parse(left.effectiveFrom);
  const rightStart = Date.parse(right.effectiveFrom);
  if (!Number.isFinite(leftStart) || !Number.isFinite(rightStart)) {
    return true;
  }
  const leftEnd = windowEndMs(left.effectiveTo);
  const rightEnd = windowEndMs(right.effectiveTo);
  return leftStart < rightEnd && rightStart < leftEnd;
}

/**
 * Integer floor: (baseMinor * rateBps) / 10_000.
 * Frozen Order Foundation rounding. 7% = 700 bps. Example: 1200 × 700 / 10000 = 84.
 */
export function calculateMerchantCommissionAmountMinor(
  commissionBaseMinor: number,
  rateBps: number,
): number {
  if (
    !Number.isInteger(commissionBaseMinor) ||
    !Number.isSafeInteger(commissionBaseMinor) ||
    commissionBaseMinor < 0
  ) {
    throw merchantCommissionBaseInvalid();
  }
  requireCommissionRateBps(rateBps);
  const amount = (BigInt(commissionBaseMinor) * BigInt(rateBps)) / 10000n;
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw merchantCommissionBaseInvalid();
  }
  return Number(amount);
}

export function calculateMerchantCommission(input: {
  commissionBaseMinor: number;
  rateBps: number;
}): MerchantCommissionCalculation {
  const commissionMinor = calculateMerchantCommissionAmountMinor(
    input.commissionBaseMinor,
    input.rateBps,
  );
  if (commissionMinor > input.commissionBaseMinor) {
    throw merchantCommissionConfigurationInvalid(
      'Merchant commission cannot exceed the commission base',
    );
  }
  return {
    commissionBaseMinor: input.commissionBaseMinor,
    rateBps: input.rateBps,
    commissionMinor,
    merchantNetFromBaseMinor: input.commissionBaseMinor - commissionMinor,
  };
}

export function selectApplicableMerchantCommissionRule(
  rules: MerchantCommissionRuleRecord[],
  merchantId: string,
  instant: Date,
): ResolvedMerchantCommissionRule {
  const effective = rules.filter((rule) =>
    isCommissionRuleEffectiveAt(rule, instant),
  );
  const overrides = effective.filter(
    (rule) =>
      rule.scope === COMMISSION_SCOPE_MERCHANT_OVERRIDE &&
      rule.merchantId === merchantId,
  );
  if (overrides.length > 1) {
    throw merchantCommissionRuleAmbiguous(
      'Multiple applicable merchant commission overrides',
    );
  }
  if (overrides.length === 1) {
    return toResolved(overrides[0]);
  }
  const globals = effective.filter(
    (rule) =>
      rule.scope === COMMISSION_SCOPE_GLOBAL_DEFAULT &&
      rule.merchantId === null,
  );
  if (globals.length === 0) {
    throw merchantCommissionRuleNotFound();
  }
  if (globals.length > 1) {
    throw merchantCommissionRuleAmbiguous(
      'Multiple applicable global commission defaults',
    );
  }
  return toResolved(globals[0]);
}

function toResolved(
  rule: MerchantCommissionRuleRecord,
): ResolvedMerchantCommissionRule {
  const scope = parseCommissionScope(rule.scope);
  requireCommissionRateBps(rule.rateBps);
  requireValidCommissionScopeMerchant({
    scope,
    merchantId: rule.merchantId,
  });
  return {
    ruleId: rule.id,
    scope,
    merchantId: rule.merchantId,
    rateBps: rule.rateBps,
  };
}
