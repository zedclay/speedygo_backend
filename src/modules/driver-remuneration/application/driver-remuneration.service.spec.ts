import { DriverRemunerationService } from './driver-remuneration.service';
import { DRIVER_REMUNERATION_ERROR_CODES } from '../domain/driver-remuneration.errors';

const DRIVER_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const ACCOUNT = '11111111-1111-7111-8111-111111111111';
const DELIVERY_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
const ORDER_ID = 'oooooooo-oooo-7ooo-8ooo-oooooooooooo';

describe('DriverRemunerationService', () => {
  let earnings: {
    findByDeliveryId: jest.Mock;
    findDriverRemunerationSnapshot: jest.Mock;
    createEarned: jest.Mock;
    aggregateDriverEarnings: jest.Mock;
    listDriverEarnings: jest.Mock;
  };
  let drivers: { findProfileByAccountId: jest.Mock };
  let service: DriverRemunerationService;
  let tx: {
    orm: {
      public: {
        Delivery: { where: jest.Mock };
      };
    };
  };

  beforeEach(() => {
    earnings = {
      findByDeliveryId: jest.fn().mockResolvedValue(null),
      findDriverRemunerationSnapshot: jest.fn().mockResolvedValue({
        driverRemunerationMinor: 300,
        customerDeliveryFeeMinor: 500,
        speedyGoDeliveryShareMinor: 200,
      }),
      createEarned: jest
        .fn()
        .mockImplementation(
          (input: {
            deliveryId: string;
            driverId: string;
            baseRemunerationMinor: number;
            bonusMinor: number;
            adjustmentMinor: number;
            netEarningMinor: number;
            validatedAt: string;
          }) =>
            Promise.resolve({
              id: 'earn-1',
              deliveryId: input.deliveryId,
              driverId: input.driverId,
              baseRemunerationMinor: input.baseRemunerationMinor,
              bonusMinor: input.bonusMinor,
              adjustmentMinor: input.adjustmentMinor,
              netEarningMinor: input.netEarningMinor,
              status: 'EARNED',
              validatedAt: input.validatedAt,
              createdAt: input.validatedAt,
              updatedAt: input.validatedAt,
            }),
        ),
      aggregateDriverEarnings: jest.fn().mockResolvedValue({
        totalEarnedMinor: 300,
        unpaidEarnedMinor: 300,
        earningCount: 1,
      }),
      listDriverEarnings: jest.fn().mockResolvedValue({
        items: [
          {
            id: 'earn-1',
            deliveryId: DELIVERY_ID,
            driverId: DRIVER_ID,
            baseRemunerationMinor: 300,
            bonusMinor: 0,
            adjustmentMinor: 0,
            netEarningMinor: 300,
            status: 'EARNED',
            validatedAt: '2026-01-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            orderId: ORDER_ID,
          },
        ],
        total: 1,
      }),
    };
    drivers = {
      findProfileByAccountId: jest.fn().mockResolvedValue({ id: DRIVER_ID }),
    };
    tx = {
      orm: {
        public: {
          Delivery: {
            where: jest.fn().mockReturnValue({
              first: jest.fn().mockResolvedValue({
                id: DELIVERY_ID,
                orderId: ORDER_ID,
                status: 'DELIVERED',
              }),
            }),
          },
        },
      },
    };
    service = new DriverRemunerationService(
      earnings as never,
      drivers as never,
    );
  });

  it('creates earning from frozen snapshot remuneration only', async () => {
    const created = await service.createForCompletedDelivery(
      {
        deliveryId: DELIVERY_ID,
        orderId: ORDER_ID,
        driverId: DRIVER_ID,
        occurredAt: '2026-06-01T12:00:00.000Z',
      },
      tx as never,
    );
    expect(created.netEarningMinor).toBe(300);
    expect(created.baseRemunerationMinor).toBe(300);
    expect(created.bonusMinor).toBe(0);
    expect(created.status).toBe('EARNED');
    expect(earnings.createEarned).toHaveBeenCalledWith(
      expect.objectContaining({
        baseRemunerationMinor: 300,
        bonusMinor: 0,
        adjustmentMinor: 0,
        netEarningMinor: 300,
        validatedAt: '2026-06-01T12:00:00.000Z',
      }),
      tx,
    );
  });

  it('reuses an existing coherent earning for the same Delivery', async () => {
    earnings.findByDeliveryId.mockResolvedValue({
      id: 'earn-1',
      deliveryId: DELIVERY_ID,
      driverId: DRIVER_ID,
      netEarningMinor: 300,
      status: 'EARNED',
    });
    const created = await service.createForCompletedDelivery(
      {
        deliveryId: DELIVERY_ID,
        orderId: ORDER_ID,
        driverId: DRIVER_ID,
        occurredAt: 't',
      },
      tx as never,
    );
    expect(created.id).toBe('earn-1');
    expect(earnings.createEarned).not.toHaveBeenCalled();
  });

  it('fails closed when Delivery is not DELIVERED', async () => {
    tx.orm.public.Delivery.where.mockReturnValue({
      first: jest.fn().mockResolvedValue({
        id: DELIVERY_ID,
        orderId: ORDER_ID,
        status: 'ARRIVED_CUSTOMER',
      }),
    });
    await expect(
      service.createForCompletedDelivery(
        {
          deliveryId: DELIVERY_ID,
          orderId: ORDER_ID,
          driverId: DRIVER_ID,
          occurredAt: 't',
        },
        tx as never,
      ),
    ).rejects.toMatchObject({
      code: DRIVER_REMUNERATION_ERROR_CODES.DRIVER_EARNING_DELIVERY_NOT_COMPLETED,
    });
  });

  it('rejects negative snapshot remuneration', async () => {
    earnings.findDriverRemunerationSnapshot.mockResolvedValue({
      driverRemunerationMinor: -1,
      customerDeliveryFeeMinor: 500,
      speedyGoDeliveryShareMinor: 200,
    });
    await expect(
      service.createForCompletedDelivery(
        {
          deliveryId: DELIVERY_ID,
          orderId: ORDER_ID,
          driverId: DRIVER_ID,
          occurredAt: 't',
        },
        tx as never,
      ),
    ).rejects.toMatchObject({
      code: DRIVER_REMUNERATION_ERROR_CODES.DRIVER_EARNING_AMOUNT_INVALID,
    });
  });

  it('returns self summary and list without foreign access', async () => {
    const summary = await service.getSummary(ACCOUNT);
    expect(summary.totalEarnedMinor).toBe(300);
    expect(summary.unpaidEarnedMinor).toBe(300);
    expect(summary.currency).toBe('DZD');
    const listed = await service.listEarnings(ACCOUNT, {
      limit: 10,
      offset: 0,
    });
    expect(listed.items[0].amountMinor).toBe(300);
    expect(listed.items[0].orderId).toBe(ORDER_ID);
    drivers.findProfileByAccountId.mockResolvedValue(null);
    await expect(service.getSummary(ACCOUNT)).rejects.toMatchObject({
      code: 'DRIVER_PROFILE_NOT_FOUND',
    });
  });
});
