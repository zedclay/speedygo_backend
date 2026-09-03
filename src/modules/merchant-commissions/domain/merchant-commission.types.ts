export const COMMISSION_SCOPE_GLOBAL_DEFAULT = 'GLOBAL_DEFAULT';
export const COMMISSION_SCOPE_MERCHANT_OVERRIDE = 'MERCHANT_OVERRIDE';

export type CommissionScope =
  | typeof COMMISSION_SCOPE_GLOBAL_DEFAULT
  | typeof COMMISSION_SCOPE_MERCHANT_OVERRIDE;

export type MerchantCommissionRuleRecord = {
  id: string;
  scope: string;
  merchantId: string | null;
  rateBps: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
};

export type ResolvedMerchantCommissionRule = {
  ruleId: string;
  scope: CommissionScope;
  merchantId: string | null;
  rateBps: number;
};

export type MerchantCommissionCalculation = {
  commissionBaseMinor: number;
  rateBps: number;
  commissionMinor: number;
  merchantNetFromBaseMinor: number;
};

export type MerchantEffectiveCommissionView = {
  merchantId: string;
  scope: CommissionScope;
  rateBps: number;
  ruleId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};
