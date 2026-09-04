import { FINANCIAL_LEDGER_ERROR_CODES } from '../domain/financial-ledger.errors';
import { buildLedgerReference } from '../domain/financial-ledger.policy';
import {
  LEDGER_DIRECTION_CREDIT,
  LEDGER_DIRECTION_DEBIT,
  LEDGER_SOURCE_COD_COLLECTION,
  LEDGER_SOURCE_COD_REMITTANCE,
  LEDGER_SOURCE_DRIVER_EARNING,
  LEDGER_SOURCE_MERCHANT_SETTLEMENT,
  LEDGER_SOURCE_PAYMENT,
  LEDGER_SOURCE_REFUND,
  LEDGER_TYPE_COD_CUSTODY,
  LEDGER_TYPE_CUSTOMER_PAYMENT,
  LEDGER_TYPE_DRIVER_PAYABLE,
  LEDGER_TYPE_MERCHANT_PAYABLE,
  LEDGER_TYPE_REFUND,
} from '../domain/financial-ledger.types';
import { FinancialLedgerService } from './financial-ledger.service';

describe('FinancialLedgerService', () => {
  let repo: {
    runInTransaction: jest.Mock;
    lockReference: jest.Mock;
    findByReference: jest.Mock;
    createEntry: jest.Mock;
    sumDirectionForMerchant: jest.Mock;
    sumDirectionForDriver: jest.Mock;
    findUnpostedElectronicPayments: jest.Mock;
    findUnpostedCodCollections: jest.Mock;
    findUnpostedCodRemittances: jest.Mock;
    findUnpostedDriverEarnings: jest.Mock;
    findUnpostedRefunds: jest.Mock;
    findUnpostedMerchantSettlements: jest.Mock;
  };
  let service: FinancialLedgerService;
  const tx = { query: jest.fn() };

  beforeEach(() => {
    repo = {
      runInTransaction: jest.fn((fn: (client: unknown) => unknown) => fn(tx)),
      lockReference: jest.fn().mockResolvedValue(undefined),
      findByReference: jest.fn().mockResolvedValue(null),
      createEntry: jest
        .fn()
        .mockImplementation(
          (input: {
            orderId: string | null;
            merchantId: string | null;
            driverId: string | null;
            type: string;
            direction: string;
            amountMinor: number;
            currency: string;
            reference: string;
          }) =>
            Promise.resolve({
              id: 'entry-1',
              orderId: input.orderId,
              merchantId: input.merchantId,
              driverId: input.driverId,
              type: input.type,
              direction: input.direction,
              amountMinor: input.amountMinor,
              currency: input.currency,
              reference: input.reference,
              reversalOfId: null,
              createdAt: '2026-02-01T00:00:00.000Z',
            }),
        ),
      sumDirectionForMerchant: jest
        .fn()
        .mockImplementation(
          (_merchantId: string, _type: string, direction: string) => {
            if (direction === LEDGER_DIRECTION_CREDIT) {
              return Promise.resolve(10000);
            }
            return Promise.resolve(2000);
          },
        ),
      sumDirectionForDriver: jest.fn().mockResolvedValue(0),
      findUnpostedElectronicPayments: jest.fn().mockResolvedValue([]),
      findUnpostedCodCollections: jest.fn().mockResolvedValue([]),
      findUnpostedCodRemittances: jest.fn().mockResolvedValue([]),
      findUnpostedDriverEarnings: jest.fn().mockResolvedValue([]),
      findUnpostedRefunds: jest.fn().mockResolvedValue([]),
      findUnpostedMerchantSettlements: jest.fn().mockResolvedValue([]),
    };
    service = new FinancialLedgerService(repo as never);
  });

  it('posts electronic payment once and replays idempotently', async () => {
    const first = await service.postElectronicPaymentSucceeded({
      paymentId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
      orderId: 'oooooooo-oooo-7ooo-8ooo-oooooooooooo',
      amountMinor: 1700,
      currency: 'DZD',
    });
    expect(first.type).toBe(LEDGER_TYPE_CUSTOMER_PAYMENT);
    expect(first.direction).toBe(LEDGER_DIRECTION_DEBIT);
    expect(first.reference).toBe(
      buildLedgerReference(
        LEDGER_SOURCE_PAYMENT,
        'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
      ),
    );
    expect(repo.createEntry).toHaveBeenCalledTimes(1);

    repo.findByReference.mockResolvedValue(first);
    const second = await service.postElectronicPaymentSucceeded({
      paymentId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
      orderId: 'oooooooo-oooo-7ooo-8ooo-oooooooooooo',
      amountMinor: 1700,
      currency: 'DZD',
    });
    expect(second.id).toBe(first.id);
    expect(repo.createEntry).toHaveBeenCalledTimes(1);
  });

  it('posts COD collection as custody DEBIT without CUSTOMER_PAYMENT type', async () => {
    await service.postCodCollection({
      collectionId: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
      orderId: 'oooooooo-oooo-7ooo-8ooo-oooooooooooo',
      driverId: 'dddddddd-dddd-7ddd-8ddd-dddddddddddd',
      amountMinor: 10000,
    });
    expect(repo.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        type: LEDGER_TYPE_COD_CUSTODY,
        direction: LEDGER_DIRECTION_DEBIT,
        amountMinor: 10000,
        reference: buildLedgerReference(
          LEDGER_SOURCE_COD_COLLECTION,
          'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
        ),
      }),
      tx,
    );
  });

  it('posts remittance custody CREDIT once; allocations are not ledger sources', async () => {
    await service.postCodRemittanceConfirmed({
      remittanceId: 'rrrrrrrr-rrrr-7rrr-8rrr-rrrrrrrrrrrr',
      driverId: 'dddddddd-dddd-7ddd-8ddd-dddddddddddd',
      confirmedAmountMinor: 4000,
    });
    expect(repo.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        type: LEDGER_TYPE_COD_CUSTODY,
        direction: LEDGER_DIRECTION_CREDIT,
        amountMinor: 4000,
        reference: buildLedgerReference(
          LEDGER_SOURCE_COD_REMITTANCE,
          'rrrrrrrr-rrrr-7rrr-8rrr-rrrrrrrrrrrr',
        ),
      }),
      tx,
    );
    expect(repo.createEntry).toHaveBeenCalledTimes(1);
  });

  it('posts zero DriverEarning as DRIVER_PAYABLE CREDIT 0', async () => {
    await service.postDriverEarning({
      earningId: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee',
      orderId: 'oooooooo-oooo-7ooo-8ooo-oooooooooooo',
      driverId: 'dddddddd-dddd-7ddd-8ddd-dddddddddddd',
      netEarningMinor: 0,
    });
    expect(repo.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        type: LEDGER_TYPE_DRIVER_PAYABLE,
        direction: LEDGER_DIRECTION_CREDIT,
        amountMinor: 0,
        reference: buildLedgerReference(
          LEDGER_SOURCE_DRIVER_EARNING,
          'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee',
        ),
      }),
      tx,
    );
  });

  it('posts negative Merchant settlement as DEBIT MERCHANT_PAYABLE', async () => {
    await service.postMerchantSettlementFinalized({
      settlementId: 'ssssssss-ssss-7sss-8sss-ssssssssssss',
      merchantId: 'mmmmmmmm-mmmm-7mmm-8mmm-mmmmmmmmmmmm',
      netPayableMinor: -2000,
    });
    expect(repo.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        type: LEDGER_TYPE_MERCHANT_PAYABLE,
        direction: LEDGER_DIRECTION_DEBIT,
        amountMinor: 2000,
      }),
      tx,
    );
  });

  it('posts zero Merchant settlement as MERCHANT_PAYABLE CREDIT 0', async () => {
    await service.postMerchantSettlementFinalized({
      settlementId: 'ssssssss-ssss-7sss-8sss-ssssssssssss',
      merchantId: 'mmmmmmmm-mmmm-7mmm-8mmm-mmmmmmmmmmmm',
      netPayableMinor: 0,
    });
    expect(repo.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        type: LEDGER_TYPE_MERCHANT_PAYABLE,
        direction: LEDGER_DIRECTION_CREDIT,
        amountMinor: 0,
      }),
      tx,
    );
  });

  it('posts Refund as REFUND DEBIT', async () => {
    await service.postRefundRefunded({
      refundId: 'ffffffff-ffff-7fff-8fff-ffffffffffff',
      orderId: 'oooooooo-oooo-7ooo-8ooo-oooooooooooo',
      amountMinor: 4000,
    });
    expect(repo.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        type: LEDGER_TYPE_REFUND,
        direction: LEDGER_DIRECTION_DEBIT,
        amountMinor: 4000,
        reference: buildLedgerReference(
          LEDGER_SOURCE_REFUND,
          'ffffffff-ffff-7fff-8fff-ffffffffffff',
        ),
      }),
      tx,
    );
  });

  it('derives cumulative Merchant position CREDIT - DEBIT', async () => {
    const position = await service.getMerchantPosition(
      'mmmmmmmm-mmmm-7mmm-8mmm-mmmmmmmmmmmm',
    );
    expect(position.netPayableMinor).toBe(8000);
  });

  it('rejects arbitrary non-canonical references', async () => {
    await expect(
      service.postIdempotent({
        orderId: null,
        merchantId: null,
        driverId: null,
        type: LEDGER_TYPE_CUSTOMER_PAYMENT,
        direction: LEDGER_DIRECTION_DEBIT,
        amountMinor: 100,
        currency: 'DZD',
        reference: 'CUSTOM:not-a-source',
      }),
    ).rejects.toMatchObject({
      code: FINANCIAL_LEDGER_ERROR_CODES.LEDGER_INVALID_SOURCE,
    });
    expect(repo.createEntry).not.toHaveBeenCalled();
  });

  it('fails closed when reference lookup is ambiguous', async () => {
    repo.findByReference.mockRejectedValue({
      code: FINANCIAL_LEDGER_ERROR_CODES.LEDGER_REFERENCE_AMBIGUOUS,
    });
    await expect(
      service.postElectronicPaymentSucceeded({
        paymentId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
        orderId: 'oooooooo-oooo-7ooo-8ooo-oooooooooooo',
        amountMinor: 1700,
        currency: 'DZD',
      }),
    ).rejects.toMatchObject({
      code: FINANCIAL_LEDGER_ERROR_CODES.LEDGER_REFERENCE_AMBIGUOUS,
    });
    expect(repo.createEntry).not.toHaveBeenCalled();
  });

  it('uses the same lock+reference path for reconciler as same-TX posting', async () => {
    const paymentId = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
    const reference = buildLedgerReference(LEDGER_SOURCE_PAYMENT, paymentId);
    repo.findUnpostedElectronicPayments.mockResolvedValue([
      {
        paymentId,
        orderId: 'oooooooo-oooo-7ooo-8ooo-oooooooooooo',
        amountMinor: 1700,
        currency: 'DZD',
      },
    ]);

    await service.reconcileUnposted(10);
    expect(repo.lockReference).toHaveBeenCalledWith(reference, tx);
    expect(repo.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({ reference }),
      tx,
    );

    repo.findByReference.mockResolvedValue({
      id: 'entry-1',
      reference,
      type: LEDGER_TYPE_CUSTOMER_PAYMENT,
      direction: LEDGER_DIRECTION_DEBIT,
      amountMinor: 1700,
      currency: 'DZD',
      orderId: 'oooooooo-oooo-7ooo-8ooo-oooooooooooo',
      merchantId: null,
      driverId: null,
      reversalOfId: null,
      createdAt: '2026-02-01T00:00:00.000Z',
    });
    repo.findUnpostedElectronicPayments.mockResolvedValue([]);
    const again = await service.reconcileUnposted(10);
    expect(again.posted).toBe(0);
  });

  it('serializes concurrent same-source workers under one lock then one insert', async () => {
    const paymentId = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
    const reference = buildLedgerReference(LEDGER_SOURCE_PAYMENT, paymentId);
    type Stored = {
      id: string;
      reference: string;
      type: string;
      direction: string;
      amountMinor: number;
      currency: string;
      orderId: string | null;
      merchantId: string | null;
      driverId: string | null;
      reversalOfId: string | null;
      createdAt: string;
    };
    let held = false;
    let stored: Stored | null = null;
    const waiters: Array<() => void> = [];
    const releaseNext = () => {
      held = false;
      const next = waiters.shift();
      if (next) next();
    };

    repo.lockReference.mockImplementation(() => {
      if (!held) {
        held = true;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        waiters.push(() => {
          held = true;
          resolve();
        });
      });
    });
    repo.findByReference.mockImplementation((ref: string) => {
      const row = stored && stored.reference === ref ? stored : null;
      if (row) {
        releaseNext();
      }
      return Promise.resolve(row);
    });
    repo.createEntry.mockImplementation(
      (input: {
        orderId: string | null;
        merchantId: string | null;
        driverId: string | null;
        type: string;
        direction: string;
        amountMinor: number;
        currency: string;
        reference: string;
      }) => {
        stored = {
          id: 'entry-1',
          ...input,
          reversalOfId: null,
          createdAt: '2026-02-01T00:00:00.000Z',
        };
        releaseNext();
        return Promise.resolve(stored);
      },
    );

    const [a, b] = await Promise.all([
      service.postElectronicPaymentSucceeded({
        paymentId,
        orderId: 'oooooooo-oooo-7ooo-8ooo-oooooooooooo',
        amountMinor: 1700,
        currency: 'DZD',
      }),
      service.postElectronicPaymentSucceeded({
        paymentId,
        orderId: 'oooooooo-oooo-7ooo-8ooo-oooooooooooo',
        amountMinor: 1700,
        currency: 'DZD',
      }),
    ]);
    expect(a.id).toBe(b.id);
    expect(a.reference).toBe(reference);
    expect(repo.createEntry).toHaveBeenCalledTimes(1);
  });

  it('uses settlement aggregate reference only (no line-level source family)', async () => {
    await service.postMerchantSettlementFinalized({
      settlementId: 'ssssssss-ssss-7sss-8sss-ssssssssssss',
      merchantId: 'mmmmmmmm-mmmm-7mmm-8mmm-mmmmmmmmmmmm',
      netPayableMinor: 8000,
    });
    expect(repo.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: buildLedgerReference(
          LEDGER_SOURCE_MERCHANT_SETTLEMENT,
          'ssssssss-ssss-7sss-8sss-ssssssssssss',
        ),
      }),
      tx,
    );
    expect(repo.createEntry).toHaveBeenCalledTimes(1);
  });
});
