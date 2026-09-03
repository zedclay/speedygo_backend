import { CUSTOMER_ERROR_CODES } from '../../customers/domain/customer.errors';
import { CHECKOUT_CLOCK } from '../../checkout/domain/checkout.clock';
import { CART_STATUS_ACTIVE } from '../../cart/domain/cart.policy';
import type {
  CartItemRecord,
  CartProductSnapshot,
  CartRecord,
} from '../../cart/domain/cart.types';
import { OrderService } from './order.service';
import { ORDER_ERROR_CODES } from '../domain/order.errors';
import type {
  OrderAddressRecord,
  OrderDetailView,
  PersistCreatedOrderInput,
} from '../domain/order.types';
import type { CheckoutPricingRuleRecord } from '../../checkout/domain/checkout.types';

const ACCOUNT = '11111111-1111-7111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-7222-8222-222222222222';
const ADDRESS_A = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const ADDRESS_B = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
const ORDER_ID = '99999999-9999-7999-8999-999999999999';

function nowIso(): string {
  return '2026-01-15T10:00:00.000Z';
}

function cartRecord(overrides: Partial<CartRecord> = {}): CartRecord {
  return {
    id: 'cart-1',
    customerId: 'cust-1',
    merchantBranchId: 'branch-1',
    status: CART_STATUS_ACTIVE,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...overrides,
  };
}

function item(overrides: Partial<CartItemRecord> = {}): CartItemRecord {
  return {
    id: 'item-1',
    cartId: 'cart-1',
    productId: 'product-1',
    quantity: 1,
    unitPriceMinor: 9999,
    optionIds: ['o-large'],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...overrides,
  };
}

function product(
  overrides: Partial<CartProductSnapshot> = {},
): CartProductSnapshot {
  return {
    productId: 'product-1',
    name: 'Coffee',
    merchantId: 'merchant-1',
    merchantBranchId: 'branch-1',
    categoryId: 'category-1',
    categoryActive: true,
    productAvailable: true,
    livePriceMinor: 1000,
    merchantStatus: 'ACTIVE',
    merchantVerifiedAt: nowIso(),
    merchantName: 'Cafe',
    branchOperationalStatus: 'ACTIVE',
    merchantOperationalReady: true,
    groups: [{ id: 'g1', required: true, minSelections: 1, maxSelections: 1 }],
    options: [
      {
        id: 'o-large',
        optionGroupId: 'g1',
        name: 'Large',
        available: true,
        additionalPriceMinor: 200,
      },
    ],
    ...overrides,
  };
}

function address(
  overrides: Partial<OrderAddressRecord> = {},
): OrderAddressRecord {
  return {
    id: ADDRESS_A,
    customerId: 'cust-1',
    addressText: 'Street 1',
    latitude: 36.75,
    longitude: 3.05,
    ...overrides,
  };
}

function pricing(
  overrides: Partial<CheckoutPricingRuleRecord> = {},
): CheckoutPricingRuleRecord {
  return {
    id: 'rule-1',
    zoneId: 'zone-1',
    name: 'All day',
    timeBand: 'DAY',
    startLocalTime: null,
    endLocalTime: null,
    customerDeliveryFeeMinor: 500,
    driverRemunerationMinor: 300,
    effectiveFrom: '2020-01-01T00:00:00.000Z',
    effectiveTo: null,
    active: true,
    ...overrides,
  };
}

function expectCode(error: unknown, code: string): void {
  expect((error as { code: string }).code).toBe(code);
}

function matchingCod(
  overrides: Partial<{
    addressId: string;
    paymentMethod: string;
    expectedMerchandiseSubtotalMinor: number;
    expectedDeliveryFeeMinor: number;
    expectedCustomerTotalMinor: number;
  }> = {},
) {
  return {
    addressId: ADDRESS_A,
    paymentMethod: 'COD',
    expectedMerchandiseSubtotalMinor: 1200,
    expectedDeliveryFeeMinor: 500,
    expectedCustomerTotalMinor: 1700,
    ...overrides,
  };
}

describe('OrderService.createOrder', () => {
  const instant = new Date('2026-01-15T10:00:00.000Z');
  let carts: {
    findProfileByAccountId: jest.Mock;
    lockCustomerProfile: jest.Mock;
    findActiveCart: jest.Mock;
    lockCart: jest.Mock;
    listItems: jest.Mock;
    lockProduct: jest.Mock;
    loadProductSnapshot: jest.Mock;
  };
  let orders: {
    runInTransaction: jest.Mock;
    lockAddress: jest.Mock;
    lockProductOption: jest.Mock;
    findCoveringZones: jest.Mock;
    listActivePricingRules: jest.Mock;
    persistCreatedOrder: jest.Mock;
    listOwnedOrders: jest.Mock;
    findOwnedOrderDetail: jest.Mock;
  };
  let service: OrderService;
  let persisted: PersistCreatedOrderInput | null;
  let cartStatus: string;

  function detailFromPersist(
    payload: PersistCreatedOrderInput,
  ): OrderDetailView {
    return {
      id: payload.orderId,
      publicReference: payload.publicReference,
      status: 'CREATED',
      fulfillmentStatus: 'PENDING_ACCEPTANCE',
      paymentMethod: payload.paymentMethod,
      createdAt: nowIso(),
      merchantBranchId: payload.merchantBranchId,
      financial: {
        currency: payload.financial.currency,
        merchandiseSubtotalMinor:
          payload.financial.grossMerchandiseSubtotalMinor,
        deliveryFeeMinor: payload.financial.customerDeliveryFeeMinor,
        customerTotalMinor: payload.financial.customerPayableMinor,
      },
      items: payload.lines.map((line, index) => ({
        id: `order-item-${index}`,
        productId: line.productId,
        productNameSnapshot: line.productNameSnapshot,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        lineTotalMinor: line.lineTotalMinor,
        options: line.options,
      })),
      deliveryAddress: {
        addressText: payload.address.addressText,
        latitude: payload.address.latitude,
        longitude: payload.address.longitude,
        instructions: null,
      },
    };
  }

  beforeEach(() => {
    persisted = null;
    cartStatus = CART_STATUS_ACTIVE;
    carts = {
      findProfileByAccountId: jest
        .fn()
        .mockResolvedValue({ id: 'cust-1', accountId: ACCOUNT }),
      lockCustomerProfile: jest.fn().mockResolvedValue(true),
      findActiveCart: jest
        .fn()
        .mockImplementation(() =>
          cartStatus === CART_STATUS_ACTIVE ? cartRecord() : null,
        ),
      lockCart: jest
        .fn()
        .mockImplementation(() => cartRecord({ status: cartStatus })),
      listItems: jest.fn().mockResolvedValue([item()]),
      lockProduct: jest.fn().mockResolvedValue(true),
      loadProductSnapshot: jest.fn().mockResolvedValue(product()),
    };
    orders = {
      runInTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      lockAddress: jest.fn().mockResolvedValue(address()),
      lockProductOption: jest.fn().mockResolvedValue(true),
      findCoveringZones: jest
        .fn()
        .mockResolvedValue([{ id: 'zone-1', name: 'Algiers' }]),
      listActivePricingRules: jest.fn().mockResolvedValue([pricing()]),
      persistCreatedOrder: jest
        .fn()
        .mockImplementation((input: PersistCreatedOrderInput) => {
          persisted = input;
          cartStatus = 'CONVERTED';
        }),
      listOwnedOrders: jest.fn(),
      findOwnedOrderDetail: jest
        .fn()
        .mockImplementation(() =>
          persisted ? detailFromPersist(persisted) : null,
        ),
    };
    const commission = {
      readCommissionDecisionAt: jest.fn().mockResolvedValue(instant),
      resolveApplicable: jest.fn().mockResolvedValue({
        ruleId: 'comm-global',
        scope: 'GLOBAL_DEFAULT',
        merchantId: null,
        rateBps: 700,
      }),
    };
    service = new OrderService(
      carts as never,
      orders as never,
      commission as never,
      {
        now: () => instant,
      },
    );
  });

  it('creates an Order from live Catalog prices and converts the Cart', async () => {
    const created = await service.createOrder(ACCOUNT, matchingCod());
    expect(created.status).toBe('CREATED');
    expect(created.fulfillmentStatus).toBe('PENDING_ACCEPTANCE');
    expect(created.paymentMethod).toBe('COD');
    expect(created.financial.merchandiseSubtotalMinor).toBe(1200);
    expect(created.financial.deliveryFeeMinor).toBe(500);
    expect(created.financial.customerTotalMinor).toBe(1700);
    expect(created.items[0].unitPriceMinor).toBe(1200);
    expect(created.items[0].productNameSnapshot).toBe('Coffee');
    expect(created.deliveryAddress.instructions).toBeNull();
    expect(persisted?.financial.merchantCommissionAmountMinor).toBe(84);
    expect(persisted?.financial.commissionBaseMinor).toBe(1200);
    expect(persisted?.financial.merchantNetAmountMinor).toBe(1116);
    expect(persisted?.financial.driverRemunerationMinor).toBe(300);
    expect(persisted?.financial.speedyGoDeliveryShareMinor).toBe(200);
    expect(persisted?.financial.customerPayableMinor).toBe(1700);
    expect(persisted?.paymentMethod).toBe('COD');
    expect(persisted?.lines[0].unitPriceMinor).not.toBe(9999);
    expect(orders.persistCreatedOrder).toHaveBeenCalledTimes(1);
  });

  it('requires CustomerProfile', async () => {
    carts.findProfileByAccountId.mockResolvedValue(null);
    try {
      await service.createOrder(ACCOUNT, matchingCod());
      throw new Error('expected profile missing');
    } catch (error) {
      expectCode(error, CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND);
    }
  });

  it('rejects a foreign Address without leaking ownership', async () => {
    orders.lockAddress.mockResolvedValue(null);
    try {
      await service.createOrder(ACCOUNT, matchingCod({ addressId: ADDRESS_B }));
      throw new Error('expected address missing');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.ORDER_ADDRESS_NOT_FOUND);
    }
    expect(orders.persistCreatedOrder).not.toHaveBeenCalled();
  });

  it('rejects missing, empty, or already converted Carts', async () => {
    carts.findActiveCart.mockResolvedValue(null);
    try {
      await service.createOrder(ACCOUNT, matchingCod());
      throw new Error('expected cart required');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.ORDER_CART_REQUIRED);
    }

    carts.findActiveCart.mockResolvedValue(cartRecord());
    carts.listItems.mockResolvedValue([]);
    try {
      await service.createOrder(ACCOUNT, matchingCod());
      throw new Error('expected empty cart');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.ORDER_CART_REQUIRED);
    }

    carts.listItems.mockResolvedValue([item()]);
    carts.lockCart.mockResolvedValue(cartRecord({ status: 'CONVERTED' }));
    try {
      await service.createOrder(ACCOUNT, matchingCod());
      throw new Error('expected already created');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.ORDER_ALREADY_CREATED);
    }
  });

  it('rejects suspended, pending-review, unverified, and unknown merchants', async () => {
    carts.loadProductSnapshot.mockResolvedValue(
      product({ merchantStatus: 'SUSPENDED', merchantOperationalReady: false }),
    );
    try {
      await service.createOrder(ACCOUNT, matchingCod());
      throw new Error('expected merchant');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.ORDER_MERCHANT_NOT_OPERATIONAL);
    }

    carts.loadProductSnapshot.mockResolvedValue(
      product({
        merchantStatus: 'PENDING_REVIEW',
        merchantVerifiedAt: null,
        merchantOperationalReady: false,
      }),
    );
    try {
      await service.createOrder(ACCOUNT, matchingCod());
      throw new Error('expected pending review');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.ORDER_MERCHANT_NOT_OPERATIONAL);
    }

    carts.loadProductSnapshot.mockResolvedValue(
      product({ merchantStatus: 'ACTIVE', merchantVerifiedAt: null }),
    );
    try {
      await service.createOrder(ACCOUNT, matchingCod());
      throw new Error('expected unverified');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.ORDER_MERCHANT_NOT_OPERATIONAL);
    }

    carts.loadProductSnapshot.mockResolvedValue(
      product({ merchantStatus: 'UNKNOWN', merchantOperationalReady: false }),
    );
    try {
      await service.createOrder(ACCOUNT, matchingCod());
      throw new Error('expected unknown status');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.ORDER_MERCHANT_NOT_OPERATIONAL);
    }

    carts.loadProductSnapshot.mockResolvedValue(
      product({ branchOperationalStatus: 'INACTIVE' }),
    );
    try {
      await service.createOrder(ACCOUNT, matchingCod());
      throw new Error('expected branch');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.ORDER_BRANCH_NOT_OPERATIONAL);
    }

    carts.loadProductSnapshot.mockResolvedValue(
      product({ categoryActive: false, merchantOperationalReady: true }),
    );
    try {
      await service.createOrder(ACCOUNT, matchingCod());
      throw new Error('expected category');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.ORDER_CART_NOT_READY);
    }

    carts.loadProductSnapshot.mockResolvedValue(
      product({ productAvailable: false }),
    );
    try {
      await service.createOrder(ACCOUNT, matchingCod());
      throw new Error('expected product');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.ORDER_CART_NOT_READY);
    }
  });

  it('fails closed for outside, boundary-ok, and overlapping zones', async () => {
    orders.findCoveringZones.mockResolvedValue([]);
    try {
      await service.createOrder(ACCOUNT, matchingCod());
      throw new Error('expected outside');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.ORDER_ADDRESS_OUTSIDE_ZONE);
    }

    orders.findCoveringZones.mockResolvedValue([
      { id: 'zone-1', name: 'A' },
      { id: 'zone-2', name: 'B' },
    ]);
    try {
      await service.createOrder(ACCOUNT, matchingCod());
      throw new Error('expected ambiguous');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.ORDER_DELIVERY_ZONE_AMBIGUOUS);
    }
  });

  it('uses the current live Delivery Fee and rejects missing/overlapping rules', async () => {
    orders.listActivePricingRules.mockResolvedValue([
      pricing({ customerDeliveryFeeMinor: 800 }),
    ]);
    const created = await service.createOrder(
      ACCOUNT,
      matchingCod({
        paymentMethod: 'ELECTRONIC',
        expectedDeliveryFeeMinor: 800,
        expectedCustomerTotalMinor: 2000,
      }),
    );
    expect(created.financial.deliveryFeeMinor).toBe(800);
    expect(created.financial.customerTotalMinor).toBe(2000);
    expect(created.paymentMethod).toBe('ELECTRONIC');
    expect(persisted?.financial.customerPayableMinor).toBe(2000);

    cartStatus = CART_STATUS_ACTIVE;
    persisted = null;
    orders.listActivePricingRules.mockResolvedValue([]);
    try {
      await service.createOrder(ACCOUNT, matchingCod());
      throw new Error('expected no rule');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.ORDER_PRICING_RULE_NOT_FOUND);
    }
  });

  it('rejects an invalid payment method before persistence', async () => {
    try {
      await service.createOrder(
        ACCOUNT,
        matchingCod({ paymentMethod: 'CARD' }),
      );
      throw new Error('expected payment method');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.ORDER_PAYMENT_METHOD_INVALID);
    }
    expect(orders.persistCreatedOrder).not.toHaveBeenCalled();
  });

  it('leaves the Cart ACTIVE when persistence fails', async () => {
    orders.persistCreatedOrder.mockRejectedValue(new Error('forced failure'));
    await expect(service.createOrder(ACCOUNT, matchingCod())).rejects.toThrow(
      'forced failure',
    );
    expect(cartStatus).toBe(CART_STATUS_ACTIVE);
  });

  it('creates at most one Order from concurrent requests on the same Cart', async () => {
    let gate = Promise.resolve();
    orders.runInTransaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const run = gate.then(() => fn({}));
        gate = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      },
    );
    const [first, second] = await Promise.allSettled([
      service.createOrder(ACCOUNT, matchingCod()),
      service.createOrder(ACCOUNT, matchingCod()),
    ]);
    const successes = [first, second].filter(
      (row) => row.status === 'fulfilled',
    );
    const failures = [first, second].filter((row) => row.status === 'rejected');
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expectCode(failures[0].reason, ORDER_ERROR_CODES.ORDER_CART_REQUIRED);
    expect(orders.persistCreatedOrder).toHaveBeenCalledTimes(1);
  });

  it('fails if a Product or selected Option disappears before snapshot', async () => {
    carts.lockProduct.mockResolvedValue(false);
    try {
      await service.createOrder(ACCOUNT, matchingCod());
      throw new Error('expected product race');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.ORDER_CART_NOT_READY);
    }
    carts.lockProduct.mockResolvedValue(true);
    orders.lockProductOption.mockResolvedValue(false);
    try {
      await service.createOrder(ACCOUNT, matchingCod());
      throw new Error('expected option race');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.ORDER_CART_NOT_READY);
    }
    expect(orders.persistCreatedOrder).not.toHaveBeenCalled();
  });

  it('requires Customer reconfirmation when live merchandise, option, or fee amounts change', async () => {
    carts.loadProductSnapshot.mockResolvedValue(
      product({ livePriceMinor: 1500 }),
    );
    try {
      await service.createOrder(ACCOUNT, matchingCod());
      throw new Error('expected merchandise reconfirmation');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.ORDER_RECONFIRMATION_REQUIRED);
      expect(
        (error as { details: { changes: string[] } }).details.changes,
      ).toEqual(['MERCHANDISE', 'CUSTOMER_TOTAL']);
    }
    expect(orders.persistCreatedOrder).not.toHaveBeenCalled();
    expect(cartStatus).toBe(CART_STATUS_ACTIVE);

    carts.loadProductSnapshot.mockResolvedValue(
      product({
        options: [
          {
            id: 'o-large',
            optionGroupId: 'g1',
            name: 'Large',
            available: true,
            additionalPriceMinor: 400,
          },
        ],
      }),
    );
    try {
      await service.createOrder(ACCOUNT, matchingCod());
      throw new Error('expected option reconfirmation');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.ORDER_RECONFIRMATION_REQUIRED);
      expect(
        (error as { details: { changes: string[] } }).details.changes,
      ).toEqual(['MERCHANDISE', 'CUSTOMER_TOTAL']);
    }

    carts.loadProductSnapshot.mockResolvedValue(product());
    orders.listActivePricingRules.mockResolvedValue([
      pricing({ customerDeliveryFeeMinor: 800 }),
    ]);
    try {
      await service.createOrder(ACCOUNT, matchingCod());
      throw new Error('expected delivery fee reconfirmation');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.ORDER_RECONFIRMATION_REQUIRED);
      expect(
        (error as { details: { changes: string[] } }).details.changes,
      ).toEqual(['DELIVERY_FEE', 'CUSTOMER_TOTAL']);
      expect(
        (error as { details: { current: { deliveryFeeMinor: number } } })
          .details.current.deliveryFeeMinor,
      ).toBe(800);
    }

    carts.loadProductSnapshot.mockResolvedValue(
      product({ livePriceMinor: 1500 }),
    );
    try {
      await service.createOrder(ACCOUNT, matchingCod());
      throw new Error('expected both reconfirmation');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.ORDER_RECONFIRMATION_REQUIRED);
      expect(
        (error as { details: { changes: string[] } }).details.changes,
      ).toEqual(['MERCHANDISE', 'DELIVERY_FEE', 'CUSTOMER_TOTAL']);
    }
    expect(orders.persistCreatedOrder).not.toHaveBeenCalled();
    expect(cartStatus).toBe(CART_STATUS_ACTIVE);

    carts.loadProductSnapshot.mockResolvedValue(product());
    const retried = await service.createOrder(
      ACCOUNT,
      matchingCod({
        expectedDeliveryFeeMinor: 800,
        expectedCustomerTotalMinor: 2000,
      }),
    );
    expect(retried.financial.deliveryFeeMinor).toBe(800);
    expect(retried.financial.customerTotalMinor).toBe(2000);
    expect(orders.persistCreatedOrder).toHaveBeenCalledTimes(1);
    expect(cartStatus).toBe('CONVERTED');
  });

  it('never lets fake lower expected amounts become price authority', async () => {
    try {
      await service.createOrder(
        ACCOUNT,
        matchingCod({
          expectedMerchandiseSubtotalMinor: 1,
          expectedDeliveryFeeMinor: 500,
          expectedCustomerTotalMinor: 501,
        }),
      );
      throw new Error('expected fake merchandise');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.ORDER_RECONFIRMATION_REQUIRED);
    }
    try {
      await service.createOrder(
        ACCOUNT,
        matchingCod({
          expectedMerchandiseSubtotalMinor: 1200,
          expectedDeliveryFeeMinor: 1,
          expectedCustomerTotalMinor: 1201,
        }),
      );
      throw new Error('expected fake fee');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.ORDER_RECONFIRMATION_REQUIRED);
    }
    try {
      await service.createOrder(
        ACCOUNT,
        matchingCod({
          expectedMerchandiseSubtotalMinor: 1200,
          expectedDeliveryFeeMinor: 500,
          expectedCustomerTotalMinor: 1,
        }),
      );
      throw new Error('expected fake total');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.ORDER_EXPECTED_AMOUNTS_INVALID);
    }
    expect(orders.persistCreatedOrder).not.toHaveBeenCalled();
    expect(cartStatus).toBe(CART_STATUS_ACTIVE);
  });
});

describe('OrderService reads', () => {
  let service: OrderService;
  let carts: { findProfileByAccountId: jest.Mock };
  let orders: {
    runInTransaction: jest.Mock;
    listOwnedOrders: jest.Mock;
    findOwnedOrderDetail: jest.Mock;
  };

  beforeEach(() => {
    carts = {
      findProfileByAccountId: jest
        .fn()
        .mockResolvedValue({ id: 'cust-1', accountId: ACCOUNT }),
    };
    orders = {
      runInTransaction: jest.fn(),
      listOwnedOrders: jest.fn().mockResolvedValue({
        items: [
          {
            id: ORDER_ID,
            publicReference: 'sgo_abc',
            status: 'CREATED',
            fulfillmentStatus: 'PENDING_ACCEPTANCE',
            paymentMethod: 'COD',
            createdAt: nowIso(),
            financial: {
              currency: 'DZD',
              merchandiseSubtotalMinor: 1200,
              deliveryFeeMinor: 500,
              customerTotalMinor: 1700,
            },
          },
        ],
        total: 1,
      }),
      findOwnedOrderDetail: jest.fn().mockResolvedValue({
        id: ORDER_ID,
        publicReference: 'sgo_abc',
        status: 'CREATED',
        fulfillmentStatus: 'PENDING_ACCEPTANCE',
        paymentMethod: 'COD',
        createdAt: nowIso(),
        merchantBranchId: 'branch-1',
        financial: {
          currency: 'DZD',
          merchandiseSubtotalMinor: 1200,
          deliveryFeeMinor: 500,
          customerTotalMinor: 1700,
        },
        items: [],
        deliveryAddress: {
          addressText: 'Street 1',
          latitude: 36.75,
          longitude: 3.05,
          instructions: null,
        },
      }),
    };
    service = new OrderService(
      carts as never,
      orders as never,
      {
        readCommissionDecisionAt: jest.fn(),
        resolveApplicable: jest.fn(),
      } as never,
      {
        now: () => new Date(),
      },
    );
  });

  it('lists only the authenticated Customer Orders, paginated newest-first by repository query', async () => {
    const listed = await service.listOrders(ACCOUNT, { limit: 10, offset: 0 });
    expect(listed.total).toBe(1);
    expect(listed.limit).toBe(10);
    expect(listed.items[0].id).toBe(ORDER_ID);
    expect(listed.items[0].financial).not.toHaveProperty(
      'merchantCommissionAmountMinor',
    );
  });

  it('hides foreign Orders as not found', async () => {
    carts.findProfileByAccountId.mockResolvedValue({
      id: 'cust-b',
      accountId: ACCOUNT_B,
    });
    orders.findOwnedOrderDetail.mockResolvedValue(null);
    try {
      await service.getOrder(ACCOUNT_B, ORDER_ID);
      throw new Error('expected hidden');
    } catch (error) {
      expectCode(error, ORDER_ERROR_CODES.ORDER_NOT_FOUND);
    }
  });
});

describe('OrderService clock token', () => {
  it('uses CHECKOUT_CLOCK', () => {
    expect(CHECKOUT_CLOCK).toBe('CHECKOUT_CLOCK');
  });
});
