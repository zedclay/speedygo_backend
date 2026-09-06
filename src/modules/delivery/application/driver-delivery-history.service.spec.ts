import { DRIVER_ERROR_CODES } from '../../drivers/domain/driver.errors';
import { DRIVER_DELIVERY_HISTORY_ERROR_CODES } from '../domain/driver-delivery-history.errors';
import { DriverDeliveryHistoryService } from './driver-delivery-history.service';

describe('DriverDeliveryHistoryService', () => {
  const DRIVER_ID = '11111111-1111-7111-8111-111111111111';
  const ACCOUNT_ID = '22222222-2222-7222-8222-222222222222';
  const DELIVERY_ID = '33333333-3333-7333-8333-333333333333';

  function row(overrides: Record<string, unknown> = {}) {
    return {
      deliveryId: DELIVERY_ID,
      orderId: '44444444-4444-7444-8444-444444444444',
      orderPublicReference: 'sgo_hist_1',
      deliveryStatus: 'DELIVERED',
      deliveredAt: '2026-06-01T12:00:00.000Z',
      pickedUpAt: '2026-06-01T11:30:00.000Z',
      arrivedCustomerAt: '2026-06-01T11:50:00.000Z',
      merchantName: 'Merchant',
      branchName: 'Branch',
      paymentMethod: 'ELECTRONIC',
      assignmentId: '55555555-5555-7555-8555-555555555555',
      servingDriverId: DRIVER_ID,
      earningId: '66666666-6666-7666-8666-666666666666',
      earningDriverId: DRIVER_ID,
      earningStatus: 'EARNED',
      earningAmountMinor: 9007199254740993n,
      earnedAt: '2026-06-01T12:00:00.000Z',
      ...overrides,
    };
  }

  function build(deps?: {
    profile?: { id: string } | null;
    listRows?: ReturnType<typeof row>[];
    detailRow?: ReturnType<typeof row> | null;
    servingCount?: number;
  }) {
    const history = {
      runConsistentRead: jest.fn(
        async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
      ),
      countCompletedHistory: jest
        .fn()
        .mockResolvedValue(deps?.listRows?.length ?? 0),
      listCompletedHistory: jest.fn().mockResolvedValue(deps?.listRows ?? []),
      findCompletedHistoryByDeliveryId: jest
        .fn()
        .mockResolvedValue(deps?.detailRow ?? null),
      countCompletingServingAssignments: jest
        .fn()
        .mockResolvedValue(deps?.servingCount ?? 1),
      serializeEarningAmount: (n: bigint) => n.toString(10),
      currency: () => 'DZD',
    };
    const drivers = {
      findProfileByAccountId: jest
        .fn()
        .mockResolvedValue(
          deps && 'profile' in deps ? deps.profile : { id: DRIVER_ID },
        ),
    };
    const service = new DriverDeliveryHistoryService(
      history as never,
      drivers as never,
    );
    return { service, history, drivers };
  }

  it('requires DriverProfile from JWT account only', async () => {
    const { service } = build({ profile: null });
    await expect(service.listHistory(ACCOUNT_ID, {})).rejects.toMatchObject({
      code: DRIVER_ERROR_CODES.DRIVER_PROFILE_NOT_FOUND,
    });
  });

  it('lists completed history with earning decimal string without Number()', async () => {
    const { service } = build({ listRows: [row()] });
    const listed = await service.listHistory(ACCOUNT_ID, {
      limit: 10,
      offset: 0,
    });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].earning.earningAmountMinor).toBe('9007199254740993');
    expect(listed.items[0]).not.toHaveProperty('orderId');
    expect(listed.items[0]).not.toHaveProperty('assignmentId');
  });

  it('detail omits orderId and assignmentId', async () => {
    const { service } = build({ detailRow: row() });
    const detail = await service.getHistoryDetail(ACCOUNT_ID, DELIVERY_ID);
    expect(detail.deliveryId).toBe(DELIVERY_ID);
    expect(detail.pickedUpAt).toBeTruthy();
    expect(detail).not.toHaveProperty('orderId');
    expect(detail).not.toHaveProperty('assignmentId');
  });

  it('detail fails closed for foreign Delivery', async () => {
    const { service } = build({ detailRow: null });
    await expect(
      service.getHistoryDetail(ACCOUNT_ID, DELIVERY_ID),
    ).rejects.toMatchObject({
      code: DRIVER_DELIVERY_HISTORY_ERROR_CODES.DRIVER_DELIVERY_HISTORY_NOT_FOUND,
    });
  });

  it('detail fails closed on ambiguous completing serving assignments', async () => {
    const { service } = build({ detailRow: row(), servingCount: 2 });
    await expect(
      service.getHistoryDetail(ACCOUNT_ID, DELIVERY_ID),
    ).rejects.toMatchObject({
      code: DRIVER_DELIVERY_HISTORY_ERROR_CODES.DRIVER_DELIVERY_HISTORY_INTEGRITY,
    });
  });

  it('rejects contradictory earning driver', async () => {
    const { service } = build({
      listRows: [
        row({
          earningDriverId: '99999999-9999-7999-8999-999999999999',
        }),
      ],
    });
    await expect(
      service.listHistory(ACCOUNT_ID, { limit: 10, offset: 0 }),
    ).rejects.toMatchObject({
      code: DRIVER_DELIVERY_HISTORY_ERROR_CODES.DRIVER_DELIVERY_HISTORY_INTEGRITY,
    });
  });

  it('rejects malformed pagination', async () => {
    const { service } = build();
    await expect(
      service.listHistory(ACCOUNT_ID, { limit: 0 }),
    ).rejects.toMatchObject({
      code: DRIVER_DELIVERY_HISTORY_ERROR_CODES.DRIVER_DELIVERY_HISTORY_QUERY_INVALID,
    });
  });
});
