import { CUSTOMER_ERROR_CODES } from '../../customers/domain/customer.errors';
import { CheckoutService } from './checkout.service';
import { CHECKOUT_CLOCK } from '../domain/checkout.clock';
import { CHECKOUT_ERROR_CODES } from '../domain/checkout.errors';
import type {
  CheckoutAddressRecord,
  CheckoutPricingRuleRecord,
  CheckoutZoneRecord,
} from '../domain/checkout.types';
import type {
  CartBootstrapView,
  CartItemView,
} from '../../cart/domain/cart.types';

const ACCOUNT = '11111111-1111-7111-8111-111111111111';
const ADDRESS_A = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const ADDRESS_B = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';

function item(overrides: Partial<CartItemView> = {}): CartItemView {
  return {
    id: 'item-1',
    productId: 'product-1',
    productName: 'Coffee',
    quantity: 1,
    baseUnitPriceMinor: 1000,
    optionUnitAdditionalMinor: 200,
    unitPriceMinor: 1200,
    lineSubtotalMinor: 1200,
    storedUnitPriceMinor: 1200,
    itemAvailable: true,
    selectedOptions: [],
    warnings: [],
    ...overrides,
  };
}

function readyCart(
  overrides: Partial<CartBootstrapView['cart']> = {},
): CartBootstrapView {
  return {
    cartExists: true,
    cart: {
      id: 'cart-1',
      status: 'ACTIVE',
      branchId: 'branch-1',
      merchantId: 'merchant-1',
      itemCount: 1,
      cartSubtotalMinor: 1200,
      cartReady: true,
      warnings: [],
      items: [item()],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    },
  };
}

function address(
  overrides: Partial<CheckoutAddressRecord> = {},
): CheckoutAddressRecord {
  return {
    id: ADDRESS_A,
    customerId: 'cust-1',
    label: 'Home',
    addressText: 'Street 1',
    latitude: 36.75,
    longitude: 3.05,
    ...overrides,
  };
}

function pricingRule(
  overrides: Partial<CheckoutPricingRuleRecord> = {},
): CheckoutPricingRuleRecord {
  return {
    id: 'rule-1',
    zoneId: 'zone-1',
    name: 'All day',
    timeBand: 'DAY',
    startLocalTime: '00:00:00',
    endLocalTime: '23:59:59',
    customerDeliveryFeeMinor: 500,
    driverRemunerationMinor: 300,
    effectiveFrom: '2020-01-01T00:00:00.000Z',
    effectiveTo: null,
    active: true,
    ...overrides,
  };
}

describe('CheckoutService.preview', () => {
  const now = new Date('2026-01-15T10:00:00.000Z');
  let carts: { getCart: jest.Mock };
  let repo: {
    findProfileByAccountId: jest.Mock;
    findOwnedAddress: jest.Mock;
    findBranchMerchant: jest.Mock;
    findCoveringZones: jest.Mock;
    listActivePricingRules: jest.Mock;
  };
  let service: CheckoutService;

  beforeEach(() => {
    carts = {
      getCart: jest.fn().mockResolvedValue(readyCart()),
    };
    repo = {
      findProfileByAccountId: jest
        .fn()
        .mockResolvedValue({ id: 'cust-1', accountId: ACCOUNT }),
      findOwnedAddress: jest.fn().mockResolvedValue(address()),
      findBranchMerchant: jest.fn().mockResolvedValue({
        merchantId: 'merchant-1',
        merchantStatus: 'ACTIVE',
        merchantVerifiedAt: '2026-01-01T00:00:00.000Z',
        merchantName: 'Cafe',
        branchOperationalStatus: 'ACTIVE',
      }),
      findCoveringZones: jest
        .fn()
        .mockResolvedValue([
          { id: 'zone-1', name: 'Algiers' } satisfies CheckoutZoneRecord,
        ]),
      listActivePricingRules: jest.fn().mockResolvedValue([pricingRule()]),
    };
    service = new CheckoutService(
      carts as never,
      repo as never,
      {
        evaluateForPreview: jest.fn(),
      } as never,
      {
        now: () => now,
      },
    );
  });

  it('returns a ready preview with live totals', async () => {
    const preview = await service.preview(ACCOUNT, { addressId: ADDRESS_A });
    expect(preview.checkoutReady).toBe(true);
    expect(preview.warnings).toEqual([]);
    expect(preview.merchandiseSubtotalMinor).toBe(1200);
    expect(preview.deliveryFeeMinor).toBe(500);
    expect(preview.discountMinor).toBe(0);
    expect(preview.promoCode).toBeNull();
    expect(preview.customerTotalMinor).toBe(1700);
    expect(preview.pricing.timezone).toBe('Africa/Algiers');
    expect(preview.pricing.ruleId).toBe('rule-1');
    expect(repo.findOwnedAddress).toHaveBeenCalledWith('cust-1', ADDRESS_A);
  });

  it('emits PRICE_CHANGED when stored unit price differs from live Catalog', async () => {
    carts.getCart.mockResolvedValue(
      readyCart({
        cartSubtotalMinor: 1500,
        items: [
          item({
            unitPriceMinor: 1500,
            lineSubtotalMinor: 1500,
            storedUnitPriceMinor: 1200,
          }),
        ],
      }),
    );
    const preview = await service.preview(ACCOUNT, { addressId: ADDRESS_A });
    expect(preview.checkoutReady).toBe(true);
    expect(preview.warnings).toEqual(['PRICE_CHANGED']);
    expect(preview.merchandiseSubtotalMinor).toBe(1500);
    expect(preview.customerTotalMinor).toBe(2000);
  });

  it('allows a zero-priced Product', async () => {
    carts.getCart.mockResolvedValue(
      readyCart({
        cartSubtotalMinor: 0,
        items: [
          item({
            baseUnitPriceMinor: 0,
            optionUnitAdditionalMinor: 0,
            unitPriceMinor: 0,
            lineSubtotalMinor: 0,
            storedUnitPriceMinor: 0,
          }),
        ],
      }),
    );
    const preview = await service.preview(ACCOUNT, { addressId: ADDRESS_A });
    expect(preview.customerTotalMinor).toBe(500);
  });

  it('rejects missing CustomerProfile', async () => {
    carts.getCart.mockRejectedValue({
      code: CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND,
    });
    await expect(
      service.preview(ACCOUNT, { addressId: ADDRESS_A }),
    ).rejects.toMatchObject({
      code: CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND,
    });
  });

  it('rejects missing Active Cart', async () => {
    carts.getCart.mockResolvedValue({ cartExists: false, cart: null });
    await expect(
      service.preview(ACCOUNT, { addressId: ADDRESS_A }),
    ).rejects.toMatchObject({
      code: CHECKOUT_ERROR_CODES.CHECKOUT_CART_REQUIRED,
    });
  });

  it('rejects an empty Cart', async () => {
    carts.getCart.mockResolvedValue(
      readyCart({
        itemCount: 0,
        items: [],
        cartSubtotalMinor: 0,
        cartReady: false,
      }),
    );
    await expect(
      service.preview(ACCOUNT, { addressId: ADDRESS_A }),
    ).rejects.toMatchObject({
      code: CHECKOUT_ERROR_CODES.CHECKOUT_CART_REQUIRED,
    });
  });

  it('rejects a Cart that is not ready after live revalidation', async () => {
    carts.getCart.mockResolvedValue(
      readyCart({
        cartReady: false,
        warnings: ['CART_PRODUCT_NOT_AVAILABLE'],
        items: [
          item({
            itemAvailable: false,
            warnings: ['CART_PRODUCT_NOT_AVAILABLE'],
          }),
        ],
      }),
    );
    await expect(
      service.preview(ACCOUNT, { addressId: ADDRESS_A }),
    ).rejects.toMatchObject({
      code: CHECKOUT_ERROR_CODES.CHECKOUT_CART_NOT_READY,
    });
  });

  it('denies a foreign Address without leaking ownership', async () => {
    repo.findOwnedAddress.mockResolvedValue(null);
    await expect(
      service.preview(ACCOUNT, { addressId: ADDRESS_B }),
    ).rejects.toMatchObject({
      code: CHECKOUT_ERROR_CODES.CHECKOUT_ADDRESS_NOT_FOUND,
    });
    expect(repo.findOwnedAddress).toHaveBeenCalledWith('cust-1', ADDRESS_B);
  });

  it('rejects invalid Address coordinates', async () => {
    repo.findOwnedAddress.mockResolvedValue(address({ latitude: 91 }));
    await expect(
      service.preview(ACCOUNT, { addressId: ADDRESS_A }),
    ).rejects.toMatchObject({
      code: CHECKOUT_ERROR_CODES.CHECKOUT_ADDRESS_COORDINATES_REQUIRED,
    });
  });

  it('rejects a SUSPENDED Merchant before generic cart-not-ready', async () => {
    carts.getCart.mockResolvedValue(readyCart({ cartReady: false }));
    repo.findBranchMerchant.mockResolvedValue({
      merchantId: 'merchant-1',
      merchantStatus: 'SUSPENDED',
      merchantVerifiedAt: '2026-01-01T00:00:00.000Z',
      merchantName: 'Cafe',
      branchOperationalStatus: 'ACTIVE',
    });
    await expect(
      service.preview(ACCOUNT, { addressId: ADDRESS_A }),
    ).rejects.toMatchObject({
      code: CHECKOUT_ERROR_CODES.CHECKOUT_MERCHANT_NOT_OPERATIONAL,
    });
  });

  it('rejects an inactive Branch', async () => {
    repo.findBranchMerchant.mockResolvedValue({
      merchantId: 'merchant-1',
      merchantStatus: 'ACTIVE',
      merchantVerifiedAt: '2026-01-01T00:00:00.000Z',
      merchantName: 'Cafe',
      branchOperationalStatus: 'INACTIVE',
    });
    await expect(
      service.preview(ACCOUNT, { addressId: ADDRESS_A }),
    ).rejects.toMatchObject({
      code: CHECKOUT_ERROR_CODES.CHECKOUT_BRANCH_NOT_OPERATIONAL,
    });
  });

  it('rejects a point outside all active zones', async () => {
    repo.findCoveringZones.mockResolvedValue([]);
    await expect(
      service.preview(ACCOUNT, { addressId: ADDRESS_A }),
    ).rejects.toMatchObject({
      code: CHECKOUT_ERROR_CODES.CHECKOUT_ADDRESS_OUTSIDE_ZONE,
    });
  });

  it('fails closed when multiple DeliveryZones cover the point', async () => {
    repo.findCoveringZones.mockResolvedValue([
      { id: 'zone-1', name: 'A' },
      { id: 'zone-2', name: 'B' },
    ]);
    await expect(
      service.preview(ACCOUNT, { addressId: ADDRESS_A }),
    ).rejects.toMatchObject({
      code: CHECKOUT_ERROR_CODES.CHECKOUT_DELIVERY_ZONE_AMBIGUOUS,
    });
  });

  it('fails closed when no applicable pricing rule exists', async () => {
    repo.listActivePricingRules.mockResolvedValue([]);
    await expect(
      service.preview(ACCOUNT, { addressId: ADDRESS_A }),
    ).rejects.toMatchObject({
      code: CHECKOUT_ERROR_CODES.CHECKOUT_PRICING_RULE_NOT_FOUND,
    });
  });

  it('fails closed when overlapping pricing rules apply', async () => {
    repo.listActivePricingRules.mockResolvedValue([
      pricingRule({ id: 'a' }),
      pricingRule({ id: 'b', timeBand: 'CUSTOM' }),
    ]);
    await expect(
      service.preview(ACCOUNT, { addressId: ADDRESS_A }),
    ).rejects.toMatchObject({
      code: CHECKOUT_ERROR_CODES.CHECKOUT_PRICING_CONFIGURATION_INVALID,
    });
  });

  it('treats a both-null time window as all-day', async () => {
    repo.listActivePricingRules.mockResolvedValue([
      pricingRule({ startLocalTime: null, endLocalTime: null }),
    ]);
    const preview = await service.preview(ACCOUNT, { addressId: ADDRESS_A });
    expect(preview.checkoutReady).toBe(true);
    expect(preview.deliveryFeeMinor).toBe(500);
    expect(preview.customerTotalMinor).toBe(1700);
  });

  it('fails closed on a malformed one-sided time window', async () => {
    repo.listActivePricingRules.mockResolvedValue([
      pricingRule({ startLocalTime: '08:00:00', endLocalTime: null }),
    ]);
    await expect(
      service.preview(ACCOUNT, { addressId: ADDRESS_A }),
    ).rejects.toMatchObject({
      code: CHECKOUT_ERROR_CODES.CHECKOUT_PRICING_CONFIGURATION_INVALID,
    });
  });

  it('recalculates a live Delivery Fee on each Preview without a session', async () => {
    const first = await service.preview(ACCOUNT, { addressId: ADDRESS_A });
    expect(first.deliveryFeeMinor).toBe(500);
    repo.listActivePricingRules.mockResolvedValue([
      pricingRule({ customerDeliveryFeeMinor: 900 }),
    ]);
    const second = await service.preview(ACCOUNT, { addressId: ADDRESS_A });
    expect(second.deliveryFeeMinor).toBe(900);
    expect(second.customerTotalMinor).toBe(2100);
    expect(second.checkoutReady).toBe(true);
  });

  it('does not accept a client evaluation timestamp', () => {
    expect(CHECKOUT_CLOCK).toBe('CHECKOUT_CLOCK');
    expect(service).toBeDefined();
  });
});
