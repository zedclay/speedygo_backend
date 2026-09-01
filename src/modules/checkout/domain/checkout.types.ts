import type { CartView } from '../../cart/domain/cart.types';

export type CheckoutTimeBand = 'DAY' | 'NIGHT' | 'CUSTOM';

export type CheckoutWarningCode = 'PRICE_CHANGED';

export type CheckoutAddressRecord = {
  id: string;
  customerId: string;
  label: string;
  addressText: string;
  latitude: number;
  longitude: number;
};

export type CheckoutZoneRecord = {
  id: string;
  name: string;
};

export type CheckoutPricingRuleRecord = {
  id: string;
  zoneId: string;
  name: string;
  timeBand: CheckoutTimeBand;
  startLocalTime: string | null;
  endLocalTime: string | null;
  customerDeliveryFeeMinor: number;
  driverRemunerationMinor: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
};

export type CheckoutPreviewInput = {
  addressId: string;
};

export type CheckoutPreviewView = {
  checkoutReady: true;
  warnings: CheckoutWarningCode[];
  cart: {
    id: string;
    branchId: string;
    merchantId: string;
    itemCount: number;
    merchandiseSubtotalMinor: number;
    items: CartView['items'];
  };
  address: {
    id: string;
    label: string;
    addressText: string;
    latitude: number;
    longitude: number;
  };
  deliveryZone: {
    id: string;
    name: string;
  };
  pricing: {
    ruleId: string;
    ruleName: string;
    timeBand: CheckoutTimeBand;
    timezone: string;
  };
  merchandiseSubtotalMinor: number;
  deliveryFeeMinor: number;
  customerTotalMinor: number;
};
