import { REFUND_ERROR_CODES } from '../domain/refund.errors';
import {
  REFUND_METHOD_MANUAL_COD,
  REFUND_METHOD_MANUAL_OTHER,
  REFUND_METHOD_ORIGINAL_PAYMENT,
  REFUND_STATUS_APPROVED,
  REFUND_STATUS_FAILED,
  REFUND_STATUS_REFUNDED,
  REFUND_STATUS_REJECTED,
  REFUND_STATUS_REQUESTED,
  REFUND_STATUS_UNDER_REVIEW,
  type RefundRecord,
} from '../domain/refund.types';
import { RefundService } from './refund.service';

const ORDER_ID = '01999999-0001-7000-8000-000000000001';
const PAYMENT_ID = '01999999-0001-7000-8000-000000000002';
const ADMIN_ID = '01999999-0001-7000-8000-000000000003';
const ACCOUNT_A = '01999999-0001-7000-8000-000000000004';
const ACCOUNT_B = '01999999-0001-7000-8000-000000000005';
const CUSTOMER_A = '01999999-0001-7000-8000-000000000006';

function refund(partial: Partial<RefundRecord> = {}): RefundRecord {
  return {
    id: '01999999-0001-7000-8000-000000000010',
    orderId: ORDER_ID,
    paymentTransactionId: null,
    refundMethod: REFUND_METHOD_MANUAL_OTHER,
    amountMinor: 3_000,
    status: REFUND_STATUS_REQUESTED,
    reason: 'goodwill',
    internalNote: null,
    requestedByAdminId: ADMIN_ID,
    requestedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('RefundService (FINAL)', () => {
  let repo: {
    runInTransaction: jest.Mock;
    adminExists: jest.Mock;
    findFinancialContextByOrderId: jest.Mock;
    lockPayment: jest.Mock;
    sumReservedAndSuccessful: jest.Mock;
    createRefund: jest.Mock;
    findById: jest.Mock;
    updateStatus: jest.Mock;
    listByOrderId: jest.Mock;
    findCustomerIdByAccountId: jest.Mock;
  };
  let service: RefundService;
  let remaining = 10_000;
  let reserved = 0;
  let successful = 0;
  let created: RefundRecord[] = [];
  let paymentMethod = 'ELECTRONIC';
  let orderStatus = 'COMPLETED';
  let paymentStatus = 'SUCCEEDED';

  beforeEach(() => {
    remaining = 10_000;
    reserved = 0;
    successful = 0;
    created = [];
    paymentMethod = 'ELECTRONIC';
    orderStatus = 'COMPLETED';
    paymentStatus = 'SUCCEEDED';
    repo = {
      runInTransaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      adminExists: jest.fn().mockResolvedValue(true),
      findFinancialContextByOrderId: jest.fn().mockImplementation(() =>
        Promise.resolve({
          orderId: ORDER_ID,
          orderStatus,
          customerId: CUSTOMER_A,
          paymentId: PAYMENT_ID,
          paymentMethod,
          paymentStatus,
          paymentAmountMinor: 10_000,
          paymentCurrency: 'DZD',
          snapshotPayableMinor: 10_000,
          snapshotCurrency: 'DZD',
        }),
      ),
      lockPayment: jest.fn().mockImplementation(() =>
        Promise.resolve({
          id: PAYMENT_ID,
          orderId: ORDER_ID,
          method: paymentMethod,
          status: paymentStatus,
          amountMinor: 10_000,
          currency: 'DZD',
        }),
      ),
      sumReservedAndSuccessful: jest.fn(() =>
        Promise.resolve({
          reservedRefundMinor: reserved,
          successfulRefundMinor: successful,
        }),
      ),
      createRefund: jest.fn((input: Partial<RefundRecord>) => {
        const row = refund({
          ...input,
          id: `r-${created.length + 1}`,
          amountMinor: input.amountMinor ?? 0,
          status: REFUND_STATUS_REQUESTED,
          refundMethod: input.refundMethod as RefundRecord['refundMethod'],
        });
        created.push(row);
        reserved += row.amountMinor;
        remaining = 10_000 - reserved;
        return Promise.resolve(row);
      }),
      findById: jest.fn((id: string) =>
        Promise.resolve(created.find((r) => r.id === id) ?? null),
      ),
      updateStatus: jest.fn(
        (input: {
          refundId: string;
          status: string;
          fromStatuses?: string[];
          setCompletedAt?: boolean;
        }) => {
          const row = created.find((r) => r.id === input.refundId);
          if (!row) {
            return Promise.resolve(null);
          }
          if (input.fromStatuses && !input.fromStatuses.includes(row.status)) {
            return Promise.resolve(row);
          }
          const previous = row.status;
          row.status = input.status as RefundRecord['status'];
          if (input.setCompletedAt) {
            row.completedAt = '2026-01-02T00:00:00.000Z';
          }
          if (input.status === REFUND_STATUS_REFUNDED) {
            if (previous !== REFUND_STATUS_REFUNDED) {
              successful += row.amountMinor;
            }
          }
          if (
            (input.status === REFUND_STATUS_FAILED ||
              input.status === REFUND_STATUS_REJECTED) &&
            previous !== REFUND_STATUS_FAILED &&
            previous !== REFUND_STATUS_REJECTED
          ) {
            reserved -= row.amountMinor;
            remaining = 10_000 - reserved;
          }
          return Promise.resolve(row);
        },
      ),
      listByOrderId: jest.fn(() => Promise.resolve(created)),
      findCustomerIdByAccountId: jest.fn((accountId: string) =>
        Promise.resolve(accountId === ACCOUNT_A ? CUSTOMER_A : null),
      ),
    };
    service = new RefundService(repo as never);
  });

  it('starts every Refund as REQUESTED', async () => {
    const row = await service.createRefund({
      orderId: ORDER_ID,
      amountMinor: 3_000,
      reason: 'partial',
      refundMethod: REFUND_METHOD_MANUAL_OTHER,
      requestedByAdminId: ADMIN_ID,
    });
    expect(row.status).toBe(REFUND_STATUS_REQUESTED);
  });

  it('blocks unpaid Payment and ACTIVE Orders', async () => {
    paymentStatus = 'PENDING';
    await expect(
      service.createRefund({
        orderId: ORDER_ID,
        amountMinor: 1_000,
        reason: 'x',
        refundMethod: REFUND_METHOD_MANUAL_OTHER,
        requestedByAdminId: ADMIN_ID,
      }),
    ).rejects.toMatchObject({
      code: REFUND_ERROR_CODES.REFUND_PAYMENT_NOT_SUCCEEDED,
    });

    paymentStatus = 'SUCCEEDED';
    orderStatus = 'ACTIVE';
    await expect(
      service.createRefund({
        orderId: ORDER_ID,
        amountMinor: 1_000,
        reason: 'x',
        refundMethod: REFUND_METHOD_MANUAL_OTHER,
        requestedByAdminId: ADMIN_ID,
      }),
    ).rejects.toMatchObject({
      code: REFUND_ERROR_CODES.REFUND_ORDER_NOT_ELIGIBLE,
    });
  });

  it('rejects ORIGINAL_PAYMENT without PROCESSING/FAILED side effects', async () => {
    await expect(
      service.createRefund({
        orderId: ORDER_ID,
        amountMinor: 1_000,
        reason: 'provider',
        refundMethod: REFUND_METHOD_ORIGINAL_PAYMENT,
        requestedByAdminId: ADMIN_ID,
      }),
    ).rejects.toMatchObject({
      code: REFUND_ERROR_CODES.REFUND_PROVIDER_UNSUPPORTED,
    });
    expect(created).toHaveLength(0);
    expect(() => service.attemptProviderRefund('any')).toThrow();
    try {
      service.attemptProviderRefund('any');
    } catch (error) {
      expect((error as { code: string }).code).toBe(
        REFUND_ERROR_CODES.REFUND_PROVIDER_UNSUPPORTED,
      );
    }
  });

  it('supports review → approve → manual REFUNDED', async () => {
    const row = await service.createRefund({
      orderId: ORDER_ID,
      amountMinor: 4_000,
      reason: 'manual',
      refundMethod: REFUND_METHOD_MANUAL_OTHER,
      requestedByAdminId: ADMIN_ID,
    });
    const reviewed = await service.markUnderReview(row.id, {
      adminId: ADMIN_ID,
    });
    expect(reviewed.status).toBe(REFUND_STATUS_UNDER_REVIEW);
    const approved = await service.authorizeRefund(row.id, {
      adminId: ADMIN_ID,
    });
    expect(approved.status).toBe(REFUND_STATUS_APPROVED);
    const confirmed = await service.confirmManualRefund(row.id, {
      adminId: ADMIN_ID,
    });
    expect(confirmed.status).toBe(REFUND_STATUS_REFUNDED);
    expect(confirmed.completedAt).not.toBeNull();
    const again = await service.confirmManualRefund(row.id, {
      adminId: ADMIN_ID,
    });
    expect(again.status).toBe(REFUND_STATUS_REFUNDED);
  });

  it('rejects REQUESTED and releases capacity', async () => {
    const row = await service.createRefund({
      orderId: ORDER_ID,
      amountMinor: 4_000,
      reason: 'x',
      refundMethod: REFUND_METHOD_MANUAL_OTHER,
      requestedByAdminId: ADMIN_ID,
    });
    expect(remaining).toBe(6_000);
    await service.rejectRefund(row.id, { adminId: ADMIN_ID });
    expect(remaining).toBe(10_000);
  });

  it('supports multiple partial refunds and blocks over-cap', async () => {
    await service.createRefund({
      orderId: ORDER_ID,
      amountMinor: 2_000,
      reason: 'a',
      refundMethod: REFUND_METHOD_MANUAL_OTHER,
      requestedByAdminId: ADMIN_ID,
    });
    await service.createRefund({
      orderId: ORDER_ID,
      amountMinor: 3_000,
      reason: 'b',
      refundMethod: REFUND_METHOD_MANUAL_OTHER,
      requestedByAdminId: ADMIN_ID,
    });
    expect(remaining).toBe(5_000);
    await expect(
      service.createRefund({
        orderId: ORDER_ID,
        amountMinor: 5_001,
        reason: 'c',
        refundMethod: REFUND_METHOD_MANUAL_OTHER,
        requestedByAdminId: ADMIN_ID,
      }),
    ).rejects.toMatchObject({
      code: REFUND_ERROR_CODES.REFUND_INSUFFICIENT_REMAINING,
    });
  });

  it('blocks further create after full reservation', async () => {
    await service.createRefund({
      orderId: ORDER_ID,
      amountMinor: 10_000,
      reason: 'full',
      refundMethod: REFUND_METHOD_MANUAL_OTHER,
      requestedByAdminId: ADMIN_ID,
    });
    await expect(
      service.createRefund({
        orderId: ORDER_ID,
        amountMinor: 1,
        reason: 'extra',
        refundMethod: REFUND_METHOD_MANUAL_OTHER,
        requestedByAdminId: ADMIN_ID,
      }),
    ).rejects.toMatchObject({
      code: REFUND_ERROR_CODES.REFUND_INSUFFICIENT_REMAINING,
    });
  });

  it('requires verified AdminProfile for trusted actions', async () => {
    repo.adminExists.mockResolvedValue(false);
    await expect(
      service.createRefund({
        orderId: ORDER_ID,
        amountMinor: 1_000,
        reason: 'x',
        refundMethod: REFUND_METHOD_MANUAL_OTHER,
        requestedByAdminId: ADMIN_ID,
      }),
    ).rejects.toMatchObject({
      code: REFUND_ERROR_CODES.REFUND_ADMIN_REQUIRED,
    });
  });

  it('uses MANUAL_COD for COD Payments only', async () => {
    paymentMethod = 'COD';
    await service.createRefund({
      orderId: ORDER_ID,
      amountMinor: 2_500,
      reason: 'cod',
      refundMethod: REFUND_METHOD_MANUAL_COD,
      requestedByAdminId: ADMIN_ID,
    });
    expect(remaining).toBe(7_500);
    await expect(
      service.createRefund({
        orderId: ORDER_ID,
        amountMinor: 100,
        reason: 'bad',
        refundMethod: REFUND_METHOD_MANUAL_OTHER,
        requestedByAdminId: ADMIN_ID,
      }),
    ).rejects.toMatchObject({
      code: REFUND_ERROR_CODES.REFUND_METHOD_INVALID,
    });
  });

  it('enforces Customer IDOR on refund read', async () => {
    await service.createRefund({
      orderId: ORDER_ID,
      amountMinor: 1_000,
      reason: 'read',
      refundMethod: REFUND_METHOD_MANUAL_OTHER,
      requestedByAdminId: ADMIN_ID,
    });
    const own = await service.listCustomerOrderRefunds(ACCOUNT_A, ORDER_ID);
    expect(own.refunds).toHaveLength(1);
    expect(own.refunds[0]?.requestedAt).toBeDefined();
    expect(
      (own.refunds[0] as { internalNote?: string }).internalNote,
    ).toBeUndefined();
    await expect(
      service.listCustomerOrderRefunds(ACCOUNT_B, ORDER_ID),
    ).rejects.toMatchObject({
      code: 'CUSTOMER_PROFILE_NOT_FOUND',
    });
  });

  it('fails actual APPROVED execution without inventing provider history on create', async () => {
    const row = await service.createRefund({
      orderId: ORDER_ID,
      amountMinor: 1_000,
      reason: 'x',
      refundMethod: REFUND_METHOD_MANUAL_OTHER,
      requestedByAdminId: ADMIN_ID,
    });
    await service.authorizeRefund(row.id, { adminId: ADMIN_ID });
    await service.failRefund(row.id, {
      adminId: ADMIN_ID,
      internalNote: 'ops aborted after failed bank transfer attempt',
    });
    expect(created[0]?.status).toBe(REFUND_STATUS_FAILED);
    expect(remaining).toBe(10_000);
  });
});
