export type OrderPaymentMethod = 'COD' | 'ELECTRONIC';

export type OrderStatus = 'CREATED';

export type OrderFulfillmentStatus = 'PENDING_ACCEPTANCE';

export type OrderAddressRecord = {
  id: string;
  customerId: string;
  addressText: string;
  latitude: number;
  longitude: number;
};

export type OrderZoneRecord = {
  id: string;
  name: string;
};

export type OrderCommissionRuleRecord = {
  id: string;
  scope: string;
  merchantId: string | null;
  rateBps: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
};

export type OrderLineSnapshot = {
  productId: string;
  productNameSnapshot: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  options: Array<{
    optionNameSnapshot: string;
    additionalPriceMinor: number;
  }>;
};

export type OrderFinancialAmounts = {
  currency: string;
  grossMerchandiseSubtotalMinor: number;
  merchantDiscountMinor: number;
  platformDiscountMinor: number;
  totalDiscountMinor: number;
  commissionBaseMinor: number;
  merchantCommissionRateBps: number;
  merchantCommissionAmountMinor: number;
  merchantNetAmountMinor: number;
  customerDeliveryFeeMinor: number;
  driverRemunerationMinor: number;
  speedyGoDeliveryShareMinor: number;
  serviceFeeMinor: number;
  customerPayableMinor: number;
  commissionRuleId: string;
  pricingRuleId: string;
};

export type CreateOrderInput = {
  addressId: string;
  paymentMethod: string;
  expectedMerchandiseSubtotalMinor: number;
  expectedDeliveryFeeMinor: number;
  expectedCustomerTotalMinor: number;
};

export type OrderListQuery = {
  limit: number;
  offset: number;
};

export type OrderItemOptionView = {
  optionNameSnapshot: string;
  additionalPriceMinor: number;
};

export type OrderItemView = {
  id: string;
  productId: string | null;
  productNameSnapshot: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  options: OrderItemOptionView[];
};

export type OrderAddressSnapshotView = {
  addressText: string;
  latitude: number;
  longitude: number;
  instructions: string | null;
};

export type OrderCustomerFinancialView = {
  currency: string;
  merchandiseSubtotalMinor: number;
  deliveryFeeMinor: number;
  customerTotalMinor: number;
};

export type OrderSummaryView = {
  id: string;
  publicReference: string;
  status: string;
  fulfillmentStatus: string;
  paymentMethod: string;
  createdAt: string;
  financial: OrderCustomerFinancialView;
};

export type OrderDetailView = OrderSummaryView & {
  merchantBranchId: string;
  items: OrderItemView[];
  deliveryAddress: OrderAddressSnapshotView;
};

export type OrderListView = {
  items: OrderSummaryView[];
  limit: number;
  offset: number;
  total: number;
};

export type PersistCreatedOrderInput = {
  orderId: string;
  publicReference: string;
  customerId: string;
  accountId: string;
  merchantBranchId: string;
  deliveryZoneId: string;
  cartId: string;
  paymentMethod: OrderPaymentMethod;
  address: OrderAddressRecord;
  lines: OrderLineSnapshot[];
  financial: OrderFinancialAmounts;
};
