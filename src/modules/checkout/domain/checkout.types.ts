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
  building: string | null;
  floor: string | null;
  entrance: string | null;
  landmark: string | null;
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
  promoCode?: string;
};

export type CheckoutPreviewView = {
  checkoutReady: true;
  warnings: CheckoutWarningCode[];
  cart: {
    id: string;
    branchId: string;
    merchantId: string;
    itemCount: number;
    merchandiseSubtotalMinor: string;
    items: CartView['items'];
  };
  address: {
    id: string;
    label: string;
    addressText: string;
    latitude: number;
    longitude: number;
    building: string | null;
    floor: string | null;
    entrance: string | null;
    landmark: string | null;
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
  merchandiseSubtotalMinor: string;
  deliveryFeeMinor: string;
  discountMinor: string;
  promoCode: string | null;
  customerTotalMinor: string;
};
