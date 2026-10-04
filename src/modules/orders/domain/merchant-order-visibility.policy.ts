import type {
  MerchantOrderFinancialAccess,
  MerchantOrderFinancialView,
  MerchantOrderVisibleFinancialView,
} from './order.types';

/**
 * Builds the role-visible financial block by allowlist so newly added
 * snapshot fields stay hidden from ROLE_RESTRICTED members by default.
 */
export function projectMerchantOrderFinancial(
  financial: MerchantOrderFinancialView,
  access: MerchantOrderFinancialAccess,
): MerchantOrderVisibleFinancialView {
  const operational = {
    currency: financial.currency,
    grossMerchandiseSubtotalMinor: financial.grossMerchandiseSubtotalMinor,
    deliveryFeeMinor: financial.deliveryFeeMinor,
  };
  if (access !== 'GRANTED') {
    return operational;
  }
  return {
    ...operational,
    merchantDiscountMinor: financial.merchantDiscountMinor,
    merchantCommissionRateBps: financial.merchantCommissionRateBps,
    merchantCommissionAmountMinor: financial.merchantCommissionAmountMinor,
    merchantNetAmountMinor: financial.merchantNetAmountMinor,
  };
}

export function projectMerchantOrderForRole<
  T extends { financial: MerchantOrderFinancialView },
>(
  view: T,
  access: MerchantOrderFinancialAccess,
): Omit<T, 'financial'> & {
  financialAccess: MerchantOrderFinancialAccess;
  financial: MerchantOrderVisibleFinancialView;
} {
  const { financial, ...rest } = view;
  return {
    ...rest,
    financialAccess: access,
    financial: projectMerchantOrderFinancial(financial, access),
  };
}
