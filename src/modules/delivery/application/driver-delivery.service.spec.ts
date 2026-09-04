import { DriverDeliveryService } from './driver-delivery.service';
import { DRIVER_DELIVERY_ERROR_CODES } from '../domain/driver-delivery.errors';

const ACCOUNT = '11111111-1111-7111-8111-111111111111';
const DRIVER_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const FOREIGN = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
const DELIVERY_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
const ORDER_ID = 'oooooooo-oooo-7ooo-8ooo-oooooooooooo';
const ASSIGNMENT_ID = 'asg-1';
const PICKUP = { latitude: 36.75, longitude: 3.05 };
const DROPOFF = { latitude: 36.76, longitude: 3.06 };

function freshNear(point: { latitude: number; longitude: number }) {
  return {
    driverId: DRIVER_ID,
    latitude: point.latitude,
    longitude: point.longitude,
    recordedAt: new Date().toISOString(),
  };
}

describe('DriverDeliveryService', () => {
  let deliveryStatus: string;
  let deliveries: {
    runInTransaction: jest.Mock;
    lockDelivery: jest.Mock;
    lockOrder: jest.Mock;
    lockPayment: jest.Mock;
    findSnapshotCustomerPayable: jest.Mock;
    transitionIfStatus: jest.Mock;
    releaseAcceptedAssignment: jest.Mock;
    completeActiveOrder: jest.Mock;
    findDeliveryById: jest.Mock;
    findDeliveryDetail: jest.Mock;
    findMatchingContext: jest.Mock;
  };
  let drivers: {
    findProfileByAccountId: jest.Mock;
    findOpenAcceptedAssignment: jest.Mock;
    findAvailability: jest.Mock;
    setAvailabilityStatus: jest.Mock;
  };
  let codCollections: { findByOrderId: jest.Mock };
  let remuneration: { createForCompletedDelivery: jest.Mock };
  let locations: { get: jest.Mock };
  let config: { get: jest.Mock };
  let service: DriverDeliveryService;

  beforeEach(() => {
    deliveryStatus = 'DRIVER_ASSIGNED';
    deliveries = {
      runInTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      lockDelivery: jest.fn().mockImplementation(() =>
        Promise.resolve({
          id: DELIVERY_ID,
          orderId: ORDER_ID,
          status: deliveryStatus,
        }),
      ),
      lockOrder: jest.fn().mockResolvedValue({
        id: ORDER_ID,
        status: 'ACTIVE',
        fulfillmentStatus: 'READY',
      }),
      lockPayment: jest.fn().mockResolvedValue({
        method: 'ELECTRONIC',
        status: 'SUCCEEDED',
        amountMinor: 1700,
      }),
      findSnapshotCustomerPayable: jest.fn().mockResolvedValue({
        customerPayableMinor: 1700,
        currency: 'DZD',
      }),
      transitionIfStatus: jest.fn().mockResolvedValue(true),
      releaseAcceptedAssignment: jest.fn().mockResolvedValue(true),
      completeActiveOrder: jest.fn().mockResolvedValue(true),
      findDeliveryById: jest.fn().mockResolvedValue({
        id: DELIVERY_ID,
        orderId: ORDER_ID,
        status: 'DRIVER_ASSIGNED',
      }),
      findDeliveryDetail: jest.fn().mockResolvedValue({
        id: DELIVERY_ID,
        status: 'TO_PICKUP',
        orderStatus: 'ACTIVE',
        fulfillmentStatus: 'READY',
        pickedUpAt: null,
        arrivedCustomerAt: null,
        deliveredAt: null,
        pickup: { ...PICKUP, phone: '0550123499' },
        dropoff: DROPOFF,
      }),
      findMatchingContext: jest.fn().mockResolvedValue({
        pickup: PICKUP,
        dropoff: DROPOFF,
        customerId: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
        publicReference: 'sgo_del',
        orderId: ORDER_ID,
      }),
    };
    drivers = {
      findProfileByAccountId: jest.fn().mockResolvedValue({
        id: DRIVER_ID,
        verificationStatus: 'APPROVED',
      }),
      findOpenAcceptedAssignment: jest.fn().mockResolvedValue({
        id: ASSIGNMENT_ID,
        deliveryId: DELIVERY_ID,
        status: 'ACCEPTED',
      }),
      findAvailability: jest.fn().mockResolvedValue({ status: 'ONLINE' }),
      setAvailabilityStatus: jest.fn().mockResolvedValue({ status: 'OFFLINE' }),
    };
    codCollections = {
      findByOrderId: jest.fn().mockResolvedValue(null),
    };
    remuneration = {
      createForCompletedDelivery: jest.fn().mockResolvedValue({
        id: 'earn-1',
        deliveryId: DELIVERY_ID,
        driverId: DRIVER_ID,
        netEarningMinor: 300,
        status: 'EARNED',
      }),
    };
    locations = {
      get: jest.fn().mockResolvedValue(freshNear(PICKUP)),
    };
    config = {
      get: jest.fn((key: string, fallback: number) => {
        if (key === 'driverDelivery.pickupRadiusMeters') {
          return 300;
        }
        if (key === 'driverDelivery.dropoffRadiusMeters') {
          return 300;
        }
        if (key === 'matching.locationMaxAgeMs') {
          return 45_000;
        }
        return fallback;
      }),
    };
    const notifications = {
      notifyDeliveryCompleted: jest.fn().mockResolvedValue(undefined),
      notifyDriverEarningCreated: jest.fn().mockResolvedValue(undefined),
    };
    service = new DriverDeliveryService(
      deliveries as never,
      drivers as never,
      locations as never,
      config as never,
      codCollections as never,
      remuneration as never,
      notifications as never,
    );
  });

  it('allows the assigned Driver to start to pickup without GPS', async () => {
    locations.get.mockResolvedValue(null);
    const view = await service.performAction(ACCOUNT, 'start-to-pickup');
    expect(deliveries.transitionIfStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        fromStatus: 'DRIVER_ASSIGNED',
        toStatus: 'TO_PICKUP',
        eventType: 'DRIVER_STARTED_TO_PICKUP',
        driverId: DRIVER_ID,
      }),
      {},
    );
    expect(view.deliveryStatus).toBe('TO_PICKUP');
    expect(locations.get).not.toHaveBeenCalled();
  });

  it('rejects a foreign or unassigned Driver', async () => {
    drivers.findProfileByAccountId.mockResolvedValue(null);
    await expect(
      service.performAction(FOREIGN, 'start-to-pickup'),
    ).rejects.toMatchObject({
      code: DRIVER_DELIVERY_ERROR_CODES.DRIVER_DELIVERY_ACTION_NOT_ALLOWED,
    });
    drivers.findProfileByAccountId.mockResolvedValue({ id: DRIVER_ID });
    drivers.findOpenAcceptedAssignment.mockResolvedValue(null);
    await expect(
      service.performAction(ACCOUNT, 'start-to-pickup'),
    ).rejects.toMatchObject({
      code: DRIVER_DELIVERY_ERROR_CODES.DRIVER_DELIVERY_ASSIGNMENT_NOT_ACTIVE,
    });
  });

  it('rejects OFFERED and released assignments', async () => {
    drivers.findOpenAcceptedAssignment.mockResolvedValue({
      id: ASSIGNMENT_ID,
      deliveryId: DELIVERY_ID,
      status: 'OFFERED',
    });
    await expect(
      service.performAction(ACCOUNT, 'start-to-pickup'),
    ).rejects.toMatchObject({
      code: DRIVER_DELIVERY_ERROR_CODES.DRIVER_DELIVERY_ASSIGNMENT_NOT_ACTIVE,
    });
  });

  it('rejects skipped transitions before GPS', async () => {
    await expect(
      service.performAction(ACCOUNT, 'arrive-customer'),
    ).rejects.toMatchObject({
      code: DRIVER_DELIVERY_ERROR_CODES.DRIVER_DELIVERY_INVALID_STATE,
    });
    expect(locations.get).not.toHaveBeenCalled();
  });

  it('allows arrive-pickup with a fresh location inside 300m', async () => {
    deliveryStatus = 'TO_PICKUP';
    deliveries.findDeliveryDetail.mockResolvedValue({
      id: DELIVERY_ID,
      status: 'AT_PICKUP',
      orderStatus: 'ACTIVE',
      fulfillmentStatus: 'READY',
      pickedUpAt: null,
      arrivedCustomerAt: null,
      deliveredAt: null,
    });
    await service.performAction(ACCOUNT, 'arrive-pickup');
    expect(deliveries.transitionIfStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'DRIVER_ARRIVED_PICKUP',
        driverId: DRIVER_ID,
      }),
      {},
    );
  });

  it('blocks arrive-pickup when location is missing, stale, or outside 300m', async () => {
    deliveryStatus = 'TO_PICKUP';
    locations.get.mockResolvedValue(null);
    await expect(
      service.performAction(ACCOUNT, 'arrive-pickup'),
    ).rejects.toMatchObject({
      code: DRIVER_DELIVERY_ERROR_CODES.DRIVER_DELIVERY_LOCATION_REQUIRED,
    });
    locations.get.mockResolvedValue({
      ...freshNear(PICKUP),
      recordedAt: '2020-01-01T00:00:00.000Z',
    });
    await expect(
      service.performAction(ACCOUNT, 'arrive-pickup'),
    ).rejects.toMatchObject({
      code: DRIVER_DELIVERY_ERROR_CODES.DRIVER_DELIVERY_LOCATION_STALE,
    });
    locations.get.mockResolvedValue(
      freshNear({ latitude: 36.8, longitude: 3.1 }),
    );
    await expect(
      service.performAction(ACCOUNT, 'arrive-pickup'),
    ).rejects.toMatchObject({
      code: DRIVER_DELIVERY_ERROR_CODES.DRIVER_DELIVERY_NOT_NEAR_PICKUP,
    });
    expect(deliveries.transitionIfStatus).not.toHaveBeenCalled();
  });

  it('allows arrive-customer against the address snapshot, not a live Customer Address', async () => {
    deliveryStatus = 'IN_TRANSIT';
    locations.get.mockResolvedValue(freshNear(DROPOFF));
    deliveries.findDeliveryDetail.mockResolvedValue({
      id: DELIVERY_ID,
      status: 'ARRIVED_CUSTOMER',
      orderStatus: 'ACTIVE',
      fulfillmentStatus: 'READY',
      pickedUpAt: 't',
      arrivedCustomerAt: 't',
      deliveredAt: null,
    });
    await service.performAction(ACCOUNT, 'arrive-customer');
    expect(deliveries.findMatchingContext).toHaveBeenCalledWith(DELIVERY_ID);
    expect(deliveries.transitionIfStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'DRIVER_ARRIVED_CUSTOMER',
        arrivedCustomerAt: true,
      }),
      {},
    );
  });

  it('blocks arrive-customer outside the snapshot radius', async () => {
    deliveryStatus = 'IN_TRANSIT';
    locations.get.mockResolvedValue(freshNear(PICKUP));
    await expect(
      service.performAction(ACCOUNT, 'arrive-customer'),
    ).rejects.toMatchObject({
      code: DRIVER_DELIVERY_ERROR_CODES.DRIVER_DELIVERY_NOT_NEAR_DROPOFF,
    });
  });

  it('does not require GPS for confirm-pickup or start-delivery', async () => {
    locations.get.mockResolvedValue(null);
    deliveryStatus = 'AT_PICKUP';
    deliveries.findDeliveryDetail.mockResolvedValue({
      id: DELIVERY_ID,
      status: 'PICKED_UP',
      orderStatus: 'ACTIVE',
      fulfillmentStatus: 'READY',
      pickedUpAt: 't',
      arrivedCustomerAt: null,
      deliveredAt: null,
    });
    await service.performAction(ACCOUNT, 'confirm-pickup');
    deliveryStatus = 'PICKED_UP';
    deliveries.findDeliveryDetail.mockResolvedValue({
      id: DELIVERY_ID,
      status: 'IN_TRANSIT',
      orderStatus: 'ACTIVE',
      fulfillmentStatus: 'READY',
      pickedUpAt: 't',
      arrivedCustomerAt: null,
      deliveredAt: null,
    });
    await service.performAction(ACCOUNT, 'start-delivery');
    expect(locations.get).not.toHaveBeenCalled();
    expect(deliveries.transitionIfStatus).toHaveBeenCalledTimes(2);
  });

  it('blocks COD final completion without fabricating collection', async () => {
    deliveryStatus = 'ARRIVED_CUSTOMER';
    deliveries.lockPayment.mockResolvedValue({
      method: 'COD',
      status: 'PENDING',
      amountMinor: 1700,
    });
    await expect(
      service.performAction(ACCOUNT, 'complete-delivery'),
    ).rejects.toMatchObject({
      code: DRIVER_DELIVERY_ERROR_CODES.DRIVER_DELIVERY_COD_COMPLETION_NOT_READY,
    });
    expect(deliveries.transitionIfStatus).not.toHaveBeenCalled();
    expect(deliveries.releaseAcceptedAssignment).not.toHaveBeenCalled();
    expect(deliveries.completeActiveOrder).not.toHaveBeenCalled();
  });

  it('completes COD delivery after authoritative COLLECTED collection', async () => {
    deliveryStatus = 'ARRIVED_CUSTOMER';
    deliveries.lockPayment.mockResolvedValue({
      method: 'COD',
      status: 'SUCCEEDED',
      amountMinor: 1700,
    });
    codCollections.findByOrderId.mockResolvedValue({
      id: 'cod-1',
      orderId: ORDER_ID,
      driverId: DRIVER_ID,
      expectedAmountMinor: 1700,
      collectedAmountMinor: 1700,
      collectedAt: 't',
      status: 'COLLECTED',
    });
    deliveries.findDeliveryDetail.mockResolvedValue({
      id: DELIVERY_ID,
      status: 'DELIVERED',
      orderStatus: 'COMPLETED',
      fulfillmentStatus: 'READY',
      pickedUpAt: 't1',
      arrivedCustomerAt: 't2',
      deliveredAt: 't3',
    });
    const view = await service.performAction(ACCOUNT, 'complete-delivery');
    expect(view.assignmentStatus).toBe('RELEASED');
    expect(deliveries.completeActiveOrder).toHaveBeenCalled();
    expect(remuneration.createForCompletedDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: DELIVERY_ID,
        orderId: ORDER_ID,
        driverId: DRIVER_ID,
      }),
      {},
    );
  });

  it('blocks COD completion when collection amount does not match snapshot', async () => {
    deliveryStatus = 'ARRIVED_CUSTOMER';
    deliveries.lockPayment.mockResolvedValue({
      method: 'COD',
      status: 'SUCCEEDED',
      amountMinor: 1700,
    });
    deliveries.findSnapshotCustomerPayable.mockResolvedValue({
      customerPayableMinor: 1800,
      currency: 'DZD',
    });
    codCollections.findByOrderId.mockResolvedValue({
      id: 'cod-1',
      orderId: ORDER_ID,
      driverId: DRIVER_ID,
      expectedAmountMinor: 1700,
      collectedAmountMinor: 1700,
      collectedAt: 't',
      status: 'COLLECTED',
    });
    await expect(
      service.performAction(ACCOUNT, 'complete-delivery'),
    ).rejects.toMatchObject({
      code: DRIVER_DELIVERY_ERROR_CODES.DRIVER_DELIVERY_COD_COMPLETION_NOT_READY,
    });
    expect(deliveries.transitionIfStatus).not.toHaveBeenCalled();
  });

  it('completes ELECTRONIC delivery without DeliveryProof and keeps ONLINE', async () => {
    deliveryStatus = 'ARRIVED_CUSTOMER';
    deliveries.findDeliveryDetail.mockResolvedValue({
      id: DELIVERY_ID,
      status: 'DELIVERED',
      orderStatus: 'COMPLETED',
      fulfillmentStatus: 'READY',
      pickedUpAt: 't1',
      arrivedCustomerAt: 't2',
      deliveredAt: 't3',
    });
    const view = await service.performAction(ACCOUNT, 'complete-delivery');
    expect(deliveries.releaseAcceptedAssignment).toHaveBeenCalled();
    expect(deliveries.completeActiveOrder).toHaveBeenCalled();
    expect(remuneration.createForCompletedDelivery).toHaveBeenCalled();
    expect(drivers.setAvailabilityStatus).not.toHaveBeenCalled();
    expect(view.assignmentStatus).toBe('RELEASED');
    expect(view.fulfillmentStatus).toBe('READY');
    expect(JSON.stringify(deliveries)).not.toContain('DeliveryProof');
    expect(JSON.stringify(deliveries)).not.toContain('PaymentTransaction');
  });

  it('does not require a second GPS check on complete-delivery', async () => {
    deliveryStatus = 'ARRIVED_CUSTOMER';
    locations.get.mockResolvedValue(null);
    deliveries.findDeliveryDetail.mockResolvedValue({
      id: DELIVERY_ID,
      status: 'DELIVERED',
      orderStatus: 'COMPLETED',
      fulfillmentStatus: 'READY',
      pickedUpAt: null,
      arrivedCustomerAt: null,
      deliveredAt: 't',
    });
    await service.performAction(ACCOUNT, 'complete-delivery');
    expect(locations.get).not.toHaveBeenCalled();
  });

  it('moves OFFLINE_AFTER_CURRENT_DELIVERY to OFFLINE on release', async () => {
    deliveryStatus = 'ARRIVED_CUSTOMER';
    drivers.findAvailability.mockResolvedValue({
      status: 'OFFLINE_AFTER_CURRENT_DELIVERY',
    });
    deliveries.findDeliveryDetail.mockResolvedValue({
      id: DELIVERY_ID,
      status: 'DELIVERED',
      orderStatus: 'COMPLETED',
      fulfillmentStatus: 'READY',
      pickedUpAt: null,
      arrivedCustomerAt: null,
      deliveredAt: 't',
    });
    await service.performAction(ACCOUNT, 'complete-delivery');
    expect(drivers.setAvailabilityStatus).toHaveBeenCalledWith(
      DRIVER_ID,
      'OFFLINE_AFTER_CURRENT_DELIVERY',
      'OFFLINE',
      {},
    );
  });

  it('does not rewrite SUSPENDED availability on completion', async () => {
    deliveryStatus = 'ARRIVED_CUSTOMER';
    drivers.findAvailability.mockResolvedValue({ status: 'SUSPENDED' });
    deliveries.findDeliveryDetail.mockResolvedValue({
      id: DELIVERY_ID,
      status: 'DELIVERED',
      orderStatus: 'COMPLETED',
      fulfillmentStatus: 'READY',
      pickedUpAt: null,
      arrivedCustomerAt: null,
      deliveredAt: 't',
    });
    await service.performAction(ACCOUNT, 'complete-delivery');
    expect(drivers.setAvailabilityStatus).not.toHaveBeenCalled();
  });

  it('rejects a second completion after the first wins', async () => {
    deliveryStatus = 'ARRIVED_CUSTOMER';
    deliveries.transitionIfStatus.mockResolvedValue(false);
    await expect(
      service.performAction(ACCOUNT, 'complete-delivery'),
    ).rejects.toMatchObject({
      code: DRIVER_DELIVERY_ERROR_CODES.DRIVER_DELIVERY_INVALID_STATE,
    });
    expect(deliveries.releaseAcceptedAssignment).not.toHaveBeenCalled();
  });

  it.each([
    [
      'start-to-pickup',
      'DRIVER_ASSIGNED',
      'TO_PICKUP',
      'DRIVER_STARTED_TO_PICKUP',
    ],
    ['arrive-pickup', 'TO_PICKUP', 'AT_PICKUP', 'DRIVER_ARRIVED_PICKUP'],
    ['confirm-pickup', 'AT_PICKUP', 'PICKED_UP', 'ORDER_PICKED_UP'],
    ['start-delivery', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERY_IN_TRANSIT'],
    [
      'arrive-customer',
      'IN_TRANSIT',
      'ARRIVED_CUSTOMER',
      'DRIVER_ARRIVED_CUSTOMER',
    ],
  ] as const)(
    'progresses %s with one Driver event',
    async (action, from, to, eventType) => {
      deliveryStatus = from;
      if (action === 'arrive-customer') {
        locations.get.mockResolvedValue(freshNear(DROPOFF));
      }
      deliveries.findDeliveryDetail.mockResolvedValue({
        id: DELIVERY_ID,
        status: to,
        orderStatus: 'ACTIVE',
        fulfillmentStatus: 'READY',
        pickedUpAt: action === 'confirm-pickup' ? 't' : null,
        arrivedCustomerAt: action === 'arrive-customer' ? 't' : null,
        deliveredAt: null,
      });
      await service.performAction(ACCOUNT, action);
      expect(deliveries.transitionIfStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          fromStatus: from,
          toStatus: to,
          eventType,
          driverId: DRIVER_ID,
        }),
        {},
      );
    },
  );

  it('rejects ELECTRONIC completion when Payment is not currently SUCCEEDED', async () => {
    deliveryStatus = 'ARRIVED_CUSTOMER';
    deliveries.lockPayment.mockResolvedValue({
      method: 'ELECTRONIC',
      status: 'PROCESSING',
    });
    await expect(
      service.performAction(ACCOUNT, 'complete-delivery'),
    ).rejects.toMatchObject({
      code: DRIVER_DELIVERY_ERROR_CODES.DRIVER_DELIVERY_PAYMENT_NOT_READY,
    });
    expect(deliveries.transitionIfStatus).not.toHaveBeenCalled();
  });

  it('lets a SUSPENDED Driver continue an accepted assignment', async () => {
    drivers.findProfileByAccountId.mockResolvedValue({
      id: DRIVER_ID,
      verificationStatus: 'SUSPENDED',
    });
    await service.performAction(ACCOUNT, 'start-to-pickup');
    expect(deliveries.transitionIfStatus).toHaveBeenCalled();
  });

  it('lets an expired-license Driver continue an accepted assignment', async () => {
    drivers.findProfileByAccountId.mockResolvedValue({
      id: DRIVER_ID,
      verificationStatus: 'APPROVED',
      operationalReady: false,
    });
    await service.performAction(ACCOUNT, 'start-to-pickup');
    expect(deliveries.transitionIfStatus).toHaveBeenCalled();
  });
});
