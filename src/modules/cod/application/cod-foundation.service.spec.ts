import { CodFoundationService } from './cod-foundation.service';
import { COD_ERROR_CODES } from '../domain/cod.errors';
import {
  COD_COLLECTION_STATUS_COLLECTED,
  COD_REMITTANCE_STATUS_CONFIRMED,
  COD_REMITTANCE_STATUS_DECLARED,
} from '../domain/cod.policy';

const ACCOUNT = '11111111-1111-7111-8111-111111111111';
const DRIVER_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const FOREIGN_DRIVER = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
const DELIVERY_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
const ORDER_ID = 'oooooooo-oooo-7ooo-8ooo-oooooooooooo';
const PAYMENT_ID = 'pppppppp-pppp-7ppp-8ppp-pppppppppppp';
const ASSIGNMENT_ID = 'asg-1';
const AMOUNT = 1700;

type CollectionRow = {
  id: string;
  orderId: string;
  driverId: string;
  expectedAmountMinor: number;
  collectedAmountMinor: number;
  collectedAt: string;
  status: string;
};

type RemittanceRow = {
  id: string;
  driverId: string;
  submittedAmountMinor: number;
  confirmedAmountMinor: number;
  status: string;
  reference: string;
  submittedAt: string;
  confirmedAt: string | null;
};

type AllocationRow = {
  id: string;
  remittanceId: string;
  collectionId: string;
  allocatedAmountMinor: number;
};

describe('CodFoundationService', () => {
  let collections: CollectionRow[];
  let remittances: RemittanceRow[];
  let allocations: AllocationRow[];
  let discrepancies: Array<{ remittanceId: string }>;
  let payment: {
    id: string;
    orderId: string;
    method: string;
    status: string;
    amountMinor: number;
    currency: string;
  };
  let deliveryStatus: string;
  let paymentUpdates: string[];
  let drivers: {
    findProfileByAccountId: jest.Mock;
    findOpenAcceptedAssignment: jest.Mock;
  };
  let prisma: {
    getDb: jest.Mock;
  };
  let service: CodFoundationService;

  function buildOrm() {
    return {
      public: {
        DriverProfile: {
          where: () => ({
            update: jest.fn().mockResolvedValue(undefined),
          }),
        },
        Delivery: {
          where: () => ({
            first: jest.fn().mockResolvedValue({
              id: DELIVERY_ID,
              orderId: ORDER_ID,
              status: deliveryStatus,
            }),
          }),
        },
        Order: {
          where: () => ({
            first: jest.fn().mockResolvedValue({
              id: ORDER_ID,
              status: 'ACTIVE',
            }),
          }),
        },
        Payment: {
          where: (_filter: { orderId?: string; id?: string }) => ({
            update: jest
              .fn()
              .mockImplementation((patch: { status?: string }) => {
                if (patch.status) {
                  payment.status = patch.status;
                  paymentUpdates.push(patch.status);
                }
                return Promise.resolve(undefined);
              }),
            first: jest.fn().mockResolvedValue(payment),
          }),
        },
        OrderFinancialSnapshot: {
          where: () => ({
            first: jest.fn().mockResolvedValue({
              orderId: ORDER_ID,
              customerPayableMinor: AMOUNT,
              currency: 'DZD',
            }),
          }),
        },
        CodCollection: {
          where: (filter: {
            orderId?: string;
            driverId?: string;
            status?: string;
          }) => ({
            first: jest.fn().mockImplementation(() => {
              if (filter.orderId) {
                return Promise.resolve(
                  collections.find((row) => row.orderId === filter.orderId) ??
                    null,
                );
              }
              return Promise.resolve(null);
            }),
            all: jest.fn().mockImplementation(() => {
              return Promise.resolve(
                collections.filter((row) => {
                  if (filter.driverId && row.driverId !== filter.driverId) {
                    return false;
                  }
                  if (filter.status && row.status !== String(filter.status)) {
                    return false;
                  }
                  return true;
                }),
              );
            }),
          }),
          create: jest.fn().mockImplementation((row: CollectionRow) => {
            if (collections.some((item) => item.orderId === row.orderId)) {
              throw Object.assign(new Error('unique_violation'), {
                code: '23505',
              });
            }
            collections.push({
              id: row.id,
              orderId: row.orderId,
              driverId: row.driverId,
              expectedAmountMinor: Number(row.expectedAmountMinor),
              collectedAmountMinor: Number(row.collectedAmountMinor),
              collectedAt: String(row.collectedAt),
              status: String(row.status),
            });
            return Promise.resolve(row);
          }),
        },
        CodRemittance: {
          where: (filter: {
            id?: string;
            driverId?: string;
            status?: string;
          }) => ({
            first: jest.fn().mockImplementation(() => {
              if (filter.id) {
                return Promise.resolve(
                  remittances.find((row) => row.id === filter.id) ?? null,
                );
              }
              return Promise.resolve(null);
            }),
            all: jest.fn().mockImplementation(() => {
              return Promise.resolve(
                remittances.filter((row) => {
                  if (filter.driverId && row.driverId !== filter.driverId) {
                    return false;
                  }
                  if (filter.status && row.status !== String(filter.status)) {
                    return false;
                  }
                  return true;
                }),
              );
            }),
            update: jest
              .fn()
              .mockImplementation((patch: Partial<RemittanceRow>) => {
                const row = remittances.find((item) => item.id === filter.id);
                if (row) {
                  Object.assign(row, patch);
                }
                return Promise.resolve(undefined);
              }),
          }),
          create: jest.fn().mockImplementation((row: RemittanceRow) => {
            remittances.push({
              id: row.id,
              driverId: row.driverId,
              submittedAmountMinor: Number(row.submittedAmountMinor),
              confirmedAmountMinor: Number(row.confirmedAmountMinor),
              status: String(row.status),
              reference: String(row.reference),
              submittedAt: String(row.submittedAt),
              confirmedAt: row.confirmedAt ? String(row.confirmedAt) : null,
            });
            return Promise.resolve(row);
          }),
        },
        CodRemittanceAllocation: {
          where: (filter: { remittanceId?: string }) => ({
            all: jest.fn().mockImplementation(() => {
              return Promise.resolve(
                allocations.filter((row) =>
                  filter.remittanceId
                    ? row.remittanceId === filter.remittanceId
                    : true,
                ),
              );
            }),
          }),
          create: jest.fn().mockImplementation((row: AllocationRow) => {
            if (
              allocations.some(
                (item) =>
                  item.remittanceId === row.remittanceId &&
                  item.collectionId === row.collectionId,
              )
            ) {
              throw Object.assign(new Error('unique_violation'), {
                code: '23505',
              });
            }
            allocations.push({
              id: row.id,
              remittanceId: row.remittanceId,
              collectionId: row.collectionId,
              allocatedAmountMinor: Number(row.allocatedAmountMinor),
            });
            return Promise.resolve(row);
          }),
        },
        CodDiscrepancy: {
          where: (filter: { remittanceId: string }) => ({
            first: jest
              .fn()
              .mockResolvedValue(
                discrepancies.find(
                  (row) => row.remittanceId === filter.remittanceId,
                ) ?? null,
              ),
          }),
          create: jest
            .fn()
            .mockImplementation((row: { remittanceId: string }) => {
              discrepancies.push({ remittanceId: row.remittanceId });
              return Promise.resolve(row);
            }),
        },
      },
    };
  }

  beforeEach(() => {
    collections = [];
    remittances = [];
    allocations = [];
    discrepancies = [];
    paymentUpdates = [];
    deliveryStatus = 'ARRIVED_CUSTOMER';
    payment = {
      id: PAYMENT_ID,
      orderId: ORDER_ID,
      method: 'COD',
      status: 'PENDING',
      amountMinor: AMOUNT,
      currency: 'DZD',
    };
    drivers = {
      findProfileByAccountId: jest.fn().mockResolvedValue({ id: DRIVER_ID }),
      findOpenAcceptedAssignment: jest.fn().mockResolvedValue({
        id: ASSIGNMENT_ID,
        deliveryId: DELIVERY_ID,
        status: 'ACCEPTED',
      }),
    };
    let txChain = Promise.resolve();
    prisma = {
      getDb: jest.fn().mockReturnValue({
        transaction: (fn: (tx: unknown) => Promise<unknown>) => {
          const run = txChain.then(() => fn({ orm: buildOrm() }));
          txChain = run.then(
            () => undefined,
            () => undefined,
          );
          return run;
        },
        orm: buildOrm(),
      }),
    };
    service = new CodFoundationService(prisma as never, drivers as never);
  });

  it('collects exact amount and marks Payment SUCCEEDED', async () => {
    const view = await service.collectCod(ACCOUNT, AMOUNT);
    expect(view.codCollectionStatus).toBe(COD_COLLECTION_STATUS_COLLECTED);
    expect(view.paymentStatus).toBe('SUCCEEDED');
    expect(collections).toHaveLength(1);
    expect(paymentUpdates).toEqual(['SUCCEEDED']);
  });

  it('rejects underpayment and overpayment without creating collection', async () => {
    await expect(
      service.collectCod(ACCOUNT, AMOUNT - 100),
    ).rejects.toMatchObject({
      code: COD_ERROR_CODES.DRIVER_COD_COLLECTION_AMOUNT_MISMATCH,
    });
    await expect(
      service.collectCod(ACCOUNT, AMOUNT + 100),
    ).rejects.toMatchObject({
      code: COD_ERROR_CODES.DRIVER_COD_COLLECTION_AMOUNT_MISMATCH,
    });
    expect(collections).toHaveLength(0);
    expect(payment.status).toBe('PENDING');
  });

  it('rejects Payment/snapshot mismatch', async () => {
    payment.amountMinor = AMOUNT + 50;
    await expect(
      service.collectCod(ACCOUNT, AMOUNT + 50),
    ).rejects.toMatchObject({
      code: COD_ERROR_CODES.DRIVER_COD_COLLECTION_AMOUNT_MISMATCH,
    });
  });

  it('replays exact collection safely without duplicate Payment transition', async () => {
    await service.collectCod(ACCOUNT, AMOUNT);
    paymentUpdates = [];
    const replay = await service.collectCod(ACCOUNT, AMOUNT);
    expect(replay.codCollectionId).toBe(collections[0].id);
    expect(collections).toHaveLength(1);
    expect(paymentUpdates).toEqual([]);
  });

  it('rejects mismatched replay amount', async () => {
    await service.collectCod(ACCOUNT, AMOUNT);
    await expect(service.collectCod(ACCOUNT, AMOUNT + 1)).rejects.toMatchObject(
      {
        code: COD_ERROR_CODES.DRIVER_COD_COLLECTION_ALREADY_EXISTS,
      },
    );
  });

  it('creates exactly one collection under concurrent exact collects', async () => {
    const [first, second] = await Promise.all([
      service.collectCod(ACCOUNT, AMOUNT),
      service.collectCod(ACCOUNT, AMOUNT),
    ]);
    expect(first.codCollectionId).toBe(second.codCollectionId);
    expect(collections).toHaveLength(1);
    expect(payment.status).toBe('SUCCEEDED');
    expect(
      paymentUpdates.filter((status) => status === 'SUCCEEDED'),
    ).toHaveLength(1);
  });

  it('fails closed when Payment is SUCCEEDED without collection', async () => {
    payment.status = 'SUCCEEDED';
    await expect(service.collectCod(ACCOUNT, AMOUNT)).rejects.toMatchObject({
      code: COD_ERROR_CODES.DRIVER_COD_COLLECTION_INCONSISTENT_STATE,
    });
  });

  it('rejects non-DZD COD currency', async () => {
    payment.currency = 'EUR';
    await expect(service.collectCod(ACCOUNT, AMOUNT)).rejects.toMatchObject({
      code: COD_ERROR_CODES.DRIVER_COD_COLLECTION_PAYMENT_NOT_ELIGIBLE,
    });
  });

  it('blocks collection outside ARRIVED_CUSTOMER', async () => {
    deliveryStatus = 'IN_TRANSIT';
    await expect(service.collectCod(ACCOUNT, AMOUNT)).rejects.toMatchObject({
      code: COD_ERROR_CODES.DRIVER_COD_COLLECTION_NOT_READY,
    });
  });

  it('blocks ELECTRONIC collect-cod', async () => {
    payment.method = 'ELECTRONIC';
    await expect(service.collectCod(ACCOUNT, AMOUNT)).rejects.toMatchObject({
      code: COD_ERROR_CODES.DRIVER_COD_COLLECTION_METHOD_NOT_COD,
    });
  });

  it('increases outstanding custody by full collected amount', async () => {
    await service.collectCod(ACCOUNT, AMOUNT);
    const summary = await service.getDriverCodSummary(ACCOUNT);
    expect(summary.outstandingCustodyMinor).toBe(AMOUNT);
    expect(summary.collectedAmountMinor).toBe(AMOUNT);
    expect(summary.confirmedAllocatedMinor).toBe(0);
  });

  it('rejects remittance declare <= 0 or above custody', async () => {
    await service.collectCod(ACCOUNT, AMOUNT);
    await expect(service.submitCodRemittance(ACCOUNT, 0)).rejects.toMatchObject(
      {
        code: COD_ERROR_CODES.DRIVER_COD_REMITTANCE_INVALID_AMOUNT,
      },
    );
    await expect(
      service.submitCodRemittance(ACCOUNT, AMOUNT + 1),
    ).rejects.toMatchObject({
      code: COD_ERROR_CODES.DRIVER_COD_REMITTANCE_INSUFFICIENT_CUSTODY,
    });
  });

  it('allows one open DECLARED remittance and does not reduce custody', async () => {
    await service.collectCod(ACCOUNT, AMOUNT);
    const declared = await service.submitCodRemittance(ACCOUNT, 500);
    expect(declared.status).toBe(COD_REMITTANCE_STATUS_DECLARED);
    const summary = await service.getDriverCodSummary(ACCOUNT);
    expect(summary.outstandingCustodyMinor).toBe(AMOUNT);
    expect(summary.openDeclaredCount).toBe(1);
    await expect(
      service.submitCodRemittance(ACCOUNT, 100),
    ).rejects.toMatchObject({
      code: COD_ERROR_CODES.DRIVER_COD_REMITTANCE_OPEN_EXISTS,
    });
  });

  it('confirms partial remittance with FIFO allocation and no discrepancy', async () => {
    await service.collectCod(ACCOUNT, AMOUNT);
    const declared = await service.submitCodRemittance(ACCOUNT, 500);
    const confirmed = await service.confirmCodRemittance(
      declared.remittanceId,
      500,
    );
    expect(confirmed.status).toBe(COD_REMITTANCE_STATUS_CONFIRMED);
    expect(allocations).toHaveLength(1);
    expect(allocations[0].allocatedAmountMinor).toBe(500);
    expect(discrepancies).toHaveLength(0);
    const summary = await service.getDriverCodSummary(ACCOUNT);
    expect(summary.outstandingCustodyMinor).toBe(AMOUNT - 500);
  });

  it('records discrepancy when confirmed differs from declared', async () => {
    await service.collectCod(ACCOUNT, AMOUNT);
    const declared = await service.submitCodRemittance(ACCOUNT, 1000);
    await service.confirmCodRemittance(declared.remittanceId, 800);
    expect(allocations.reduce((s, a) => s + a.allocatedAmountMinor, 0)).toBe(
      800,
    );
    expect(discrepancies).toHaveLength(1);
    const summary = await service.getDriverCodSummary(ACCOUNT);
    expect(summary.outstandingCustodyMinor).toBe(AMOUNT - 800);
  });

  it('allows confirmed over declaration within custody and records discrepancy', async () => {
    await service.collectCod(ACCOUNT, AMOUNT);
    const declared = await service.submitCodRemittance(ACCOUNT, 800);
    await service.confirmCodRemittance(declared.remittanceId, 1000);
    expect(allocations.reduce((s, a) => s + a.allocatedAmountMinor, 0)).toBe(
      1000,
    );
    expect(discrepancies).toHaveLength(1);
  });

  it('rejects confirmation above outstanding custody', async () => {
    await service.collectCod(ACCOUNT, AMOUNT);
    const declared = await service.submitCodRemittance(ACCOUNT, AMOUNT);
    await expect(
      service.confirmCodRemittance(declared.remittanceId, AMOUNT + 1),
    ).rejects.toMatchObject({
      code: COD_ERROR_CODES.DRIVER_COD_REMITTANCE_INSUFFICIENT_CUSTODY,
    });
  });

  it('allocates FIFO across older then newer collections', async () => {
    collections = [
      {
        id: 'c-old',
        orderId: 'o1',
        driverId: DRIVER_ID,
        expectedAmountMinor: 4000,
        collectedAmountMinor: 4000,
        collectedAt: '2026-01-01T00:00:00.000Z',
        status: COD_COLLECTION_STATUS_COLLECTED,
      },
      {
        id: 'c-new',
        orderId: 'o2',
        driverId: DRIVER_ID,
        expectedAmountMinor: 5000,
        collectedAmountMinor: 5000,
        collectedAt: '2026-01-02T00:00:00.000Z',
        status: COD_COLLECTION_STATUS_COLLECTED,
      },
    ];
    remittances = [
      {
        id: 'r1',
        driverId: DRIVER_ID,
        submittedAmountMinor: 6000,
        confirmedAmountMinor: 0,
        status: COD_REMITTANCE_STATUS_DECLARED,
        reference: 'codr_1',
        submittedAt: '2026-01-03T00:00:00.000Z',
        confirmedAt: null,
      },
    ];
    await service.confirmCodRemittance('r1', 6000);
    expect(allocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          collectionId: 'c-old',
          allocatedAmountMinor: 4000,
        }),
        expect.objectContaining({
          collectionId: 'c-new',
          allocatedAmountMinor: 2000,
        }),
      ]),
    );
  });

  it('rejects second confirmation without duplicate allocations', async () => {
    await service.collectCod(ACCOUNT, AMOUNT);
    const declared = await service.submitCodRemittance(ACCOUNT, 500);
    await service.confirmCodRemittance(declared.remittanceId, 500);
    await expect(
      service.confirmCodRemittance(declared.remittanceId, 500),
    ).rejects.toMatchObject({
      code: COD_ERROR_CODES.DRIVER_COD_REMITTANCE_ALREADY_CONFIRMED,
    });
    expect(allocations).toHaveLength(1);
    expect(discrepancies).toHaveLength(0);
  });

  it('does not double-allocate under concurrent confirmation', async () => {
    await service.collectCod(ACCOUNT, AMOUNT);
    const declared = await service.submitCodRemittance(ACCOUNT, 500);
    const results = await Promise.allSettled([
      service.confirmCodRemittance(declared.remittanceId, 500),
      service.confirmCodRemittance(declared.remittanceId, 500),
    ]);
    const fulfilled = results.filter((row) => row.status === 'fulfilled');
    const rejected = results.filter((row) => row.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(allocations).toHaveLength(1);
    expect(
      allocations.reduce((sum, row) => sum + row.allocatedAmountMinor, 0),
    ).toBe(500);
  });

  it('rejects a second DECLARED remittance against the same custody', async () => {
    await service.collectCod(ACCOUNT, AMOUNT);
    const results = await Promise.allSettled([
      service.submitCodRemittance(ACCOUNT, 500),
      service.submitCodRemittance(ACCOUNT, 500),
    ]);
    const fulfilled = results.filter((row) => row.status === 'fulfilled');
    const rejected = results.filter((row) => row.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(remittances).toHaveLength(1);
    const summary = await service.getDriverCodSummary(ACCOUNT);
    expect(summary.outstandingCustodyMinor).toBe(AMOUNT);
  });

  it('rejects foreign Driver ownership on collection reuse', async () => {
    await service.collectCod(ACCOUNT, AMOUNT);
    drivers.findProfileByAccountId.mockResolvedValue({ id: FOREIGN_DRIVER });
    await expect(service.collectCod(ACCOUNT, AMOUNT)).rejects.toMatchObject({
      code: COD_ERROR_CODES.DRIVER_COD_COLLECTION_ALREADY_EXISTS,
    });
  });
});
