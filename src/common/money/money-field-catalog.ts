/**
 * Explicit dzd-v2 HTTP field catalog. Not a generic key-renamer.
 * v1 *Minor fields are integer centimes. v2 fields are DZD majors scale-2 strings.
 * RATE_BPS / commission bps fields are intentionally absent.
 */

export const MONEY_V2_CURRENCY = 'DZD' as const;

export type MoneyHttpField = {
  /** v1 JSON key (*Minor = centimes digit-string or integer). */
  v1: string;
  /** dzd-v2 JSON key (DZD majors "650.00"). */
  v2: string;
  signed: boolean;
  surfaces: readonly string[];
};

export const MONEY_HTTP_FIELDS: readonly MoneyHttpField[] = [
  { v1: 'amountMinor', v2: 'amount', signed: false, surfaces: ['payments', 'refunds', 'ledger', 'earnings-item'] },
  { v1: 'priceMinor', v2: 'price', signed: false, surfaces: ['catalog'] },
  { v1: 'additionalPriceMinor', v2: 'additionalPrice', signed: false, surfaces: ['catalog'] },
  { v1: 'unitPriceMinor', v2: 'unitPrice', signed: false, surfaces: ['cart', 'order-items'] },
  { v1: 'lineTotalMinor', v2: 'lineTotal', signed: false, surfaces: ['order-items'] },
  { v1: 'cartSubtotalMinor', v2: 'cartSubtotal', signed: false, surfaces: ['cart'] },
  { v1: 'merchandiseSubtotalMinor', v2: 'merchandiseSubtotal', signed: false, surfaces: ['checkout', 'orders'] },
  { v1: 'deliveryFeeMinor', v2: 'deliveryFee', signed: false, surfaces: ['checkout'] },
  { v1: 'customerTotalMinor', v2: 'customerTotal', signed: false, surfaces: ['checkout'] },
  { v1: 'customerPayableMinor', v2: 'customerPayable', signed: false, surfaces: ['orders', 'ofs'] },
  { v1: 'customerDeliveryFeeMinor', v2: 'customerDeliveryFee', signed: false, surfaces: ['pricing', 'ofs'] },
  { v1: 'driverRemunerationMinor', v2: 'driverRemuneration', signed: false, surfaces: ['pricing', 'ofs'] },
  { v1: 'grossMerchandiseSubtotalMinor', v2: 'grossMerchandiseSubtotal', signed: false, surfaces: ['ofs'] },
  { v1: 'merchantDiscountMinor', v2: 'merchantDiscount', signed: false, surfaces: ['ofs'] },
  { v1: 'platformDiscountMinor', v2: 'platformDiscount', signed: false, surfaces: ['ofs'] },
  { v1: 'totalDiscountMinor', v2: 'totalDiscount', signed: false, surfaces: ['ofs'] },
  {
    v1: 'discountMinor',
    v2: 'discount',
    signed: false,
    surfaces: ['checkout', 'orders'],
  },
  { v1: 'discountAmountMinor', v2: 'discountAmount', signed: false, surfaces: ['promotions'] },
  { v1: 'commissionBaseMinor', v2: 'commissionBase', signed: false, surfaces: ['ofs'] },
  { v1: 'merchantCommissionAmountMinor', v2: 'merchantCommissionAmount', signed: false, surfaces: ['ofs'] },
  { v1: 'merchantNetAmountMinor', v2: 'merchantNetAmount', signed: false, surfaces: ['ofs'] },
  { v1: 'speedyGoDeliveryShareMinor', v2: 'speedyGoDeliveryShare', signed: false, surfaces: ['ofs'] },
  { v1: 'serviceFeeMinor', v2: 'serviceFee', signed: false, surfaces: ['ofs'] },
  { v1: 'baseRemunerationMinor', v2: 'baseRemuneration', signed: false, surfaces: ['earnings'] },
  { v1: 'bonusMinor', v2: 'bonus', signed: false, surfaces: ['earnings'] },
  { v1: 'adjustmentMinor', v2: 'adjustment', signed: true, surfaces: ['earnings', 'settlements'] },
  { v1: 'netEarningMinor', v2: 'netEarning', signed: false, surfaces: ['earnings'] },
  { v1: 'totalEarnedMinor', v2: 'totalEarned', signed: false, surfaces: ['earnings'] },
  { v1: 'unpaidEarnedMinor', v2: 'unpaidEarned', signed: false, surfaces: ['earnings'] },
  { v1: 'expectedAmountMinor', v2: 'expectedAmount', signed: false, surfaces: ['cod'] },
  { v1: 'collectedAmountMinor', v2: 'collectedAmount', signed: false, surfaces: ['cod'] },
  { v1: 'submittedAmountMinor', v2: 'submittedAmount', signed: false, surfaces: ['cod'] },
  { v1: 'confirmedAmountMinor', v2: 'confirmedAmount', signed: false, surfaces: ['cod'] },
  { v1: 'allocatedAmountMinor', v2: 'allocatedAmount', signed: false, surfaces: ['cod'] },
  { v1: 'outstandingCustodyMinor', v2: 'outstandingCustody', signed: false, surfaces: ['cod'] },
  { v1: 'confirmedAllocatedMinor', v2: 'confirmedAllocated', signed: false, surfaces: ['cod'] },
  { v1: 'expectedMinor', v2: 'expectedAmount', signed: false, surfaces: ['cod-discrepancy'] },
  { v1: 'confirmedMinor', v2: 'confirmedAmount', signed: false, surfaces: ['cod-discrepancy'] },
  { v1: 'differenceMinor', v2: 'differenceAmount', signed: true, surfaces: ['cod-discrepancy'] },
  { v1: 'grossSalesMinor', v2: 'grossSales', signed: false, surfaces: ['settlements'] },
  { v1: 'commissionMinor', v2: 'commission', signed: false, surfaces: ['settlements'] },
  { v1: 'refundAdjustmentsMinor', v2: 'refundAdjustments', signed: true, surfaces: ['settlements'] },
  { v1: 'manualAdjustmentsMinor', v2: 'manualAdjustments', signed: true, surfaces: ['settlements'] },
  { v1: 'netPayableMinor', v2: 'netPayable', signed: true, surfaces: ['settlements'] },
  { v1: 'grossMerchandiseMinor', v2: 'grossMerchandise', signed: false, surfaces: ['settlements'] },
  { v1: 'merchantNetMinor', v2: 'merchantNet', signed: true, surfaces: ['settlements'] },
  { v1: 'merchantLiabilityMinor', v2: 'merchantLiability', signed: false, surfaces: ['settlements'] },
  { v1: 'expectedMerchandiseSubtotalMinor', v2: 'expectedMerchandiseSubtotal', signed: false, surfaces: ['orders-write'] },
  { v1: 'expectedDeliveryFeeMinor', v2: 'expectedDeliveryFee', signed: false, surfaces: ['orders-write'] },
  { v1: 'expectedCustomerTotalMinor', v2: 'expectedCustomerTotal', signed: false, surfaces: ['orders-write'] },
] as const;

export const MONEY_HTTP_FIELD_BY_V1: ReadonlyMap<string, MoneyHttpField> =
  new Map(MONEY_HTTP_FIELDS.map((f) => [f.v1, f]));

/** Contract versions this API implements. All others are rejected at the boundary. */
export const SUPPORTED_MONEY_CONTRACTS = ['minor-v1', 'dzd-v2'] as const;

export const UNSUPPORTED_MONEY_CONTRACTS = [
  'money-v3',
  'MONEY_JSON_UNIT=dzd',
  'treating *Minor as DZD majors',
  'bare JSON numbers under dzd-v2',
] as const;

export const MONEY_PRISMA_DECIMAL_COLUMN: Readonly<Record<string, string>> = {
  amountMinor: 'amount',
  priceMinor: 'price',
  additionalPriceMinor: 'additional_price',
  unitPriceMinor: 'unit_price',
  lineTotalMinor: 'line_total',
  customerDeliveryFeeMinor: 'customer_delivery_fee',
  driverRemunerationMinor: 'driver_remuneration',
  grossMerchandiseSubtotalMinor: 'gross_merchandise_subtotal',
  merchantDiscountMinor: 'merchant_discount',
  platformDiscountMinor: 'platform_discount',
  totalDiscountMinor: 'total_discount',
  commissionBaseMinor: 'commission_base',
  merchantCommissionAmountMinor: 'merchant_commission_amount',
  merchantNetAmountMinor: 'merchant_net_amount',
  speedyGoDeliveryShareMinor: 'speedygo_delivery_share',
  serviceFeeMinor: 'service_fee',
  customerPayableMinor: 'customer_payable',
  baseRemunerationMinor: 'base_remuneration',
  bonusMinor: 'bonus',
  adjustmentMinor: 'adjustment',
  netEarningMinor: 'net_earning',
  expectedAmountMinor: 'expected_amount',
  collectedAmountMinor: 'collected_amount',
  submittedAmountMinor: 'submitted_amount',
  confirmedAmountMinor: 'confirmed_amount',
  allocatedAmountMinor: 'allocated_amount',
  expectedMinor: 'expected_amount',
  confirmedMinor: 'confirmed_amount',
  differenceMinor: 'difference_amount',
  grossSalesMinor: 'gross_sales',
  commissionMinor: 'commission',
  refundAdjustmentsMinor: 'refund_adjustments',
  manualAdjustmentsMinor: 'manual_adjustments',
  netPayableMinor: 'net_payable',
  grossMerchandiseMinor: 'gross_merchandise',
  merchantNetMinor: 'merchant_net',
  discountAmountMinor: 'discount_amount',
};
