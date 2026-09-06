import { moneyMinorToDecimalString } from '../../../common/money/money-minor';
import { isPostgresUniqueViolation } from '../../../common/errors/postgres-unique';
import { ORDER_ERROR_CODES } from '../../orders/domain/order.errors';
import {
  REFUND_REQUEST_ORIGIN_CUSTOMER_CANCELLATION,
  REFUND_REQUEST_ORIGIN_LATE_PAYMENT_SUCCESS,
  REFUND_REQUEST_ORIGIN_MERCHANT_REJECTION,
} from '../domain/refund.types';
import {
  PaidTerminalRefundService,
  paidTerminalIntentKeyForPayment,
} from './paid-terminal-refund.service';

jest.mock('../../../common/errors/postgres-unique', () => ({
  isPostgresUniqueViolation: jest.fn(),
}));

describe('PaidTerminalRefundService', () => {
  const paymentId = '11111111-1111-7111-8111-111111111111';
  let refunds: {
    findFinancialContextByOrderId: jest.Mock;
    lockPayment: jest.Mock;
    sumReservedAndSuccessful: jest.Mock;
    listByOrderId: jest.Mock;
    createRefund: jest.Mock;
    findByPaidTerminalIntentKey: jest.Mock;
  };
  let service: PaidTerminalRefundService;

  beforeEach(() => {
    (isPostgresUniqueViolation as jest.Mock).mockReturnValue(false);
    refunds = {
      findFinancialContextByOrderId: jest.fn().mockResolvedValue({
        orderId: 'order-1',
        orderStatus: 'CANCELLED',
        paymentId,
        snapshotPayableMinor: 1700,
        snapshotCurrency: 'DZD',
      }),
      lockPayment: jest.fn().mockResolvedValue({
        id: paymentId,
        method: 'ELECTRONIC',
        status: 'SUCCEEDED',
        amountMinor: 1700,
        currency: 'DZD',
      }),
      sumReservedAndSuccessful: jest.fn().mockResolvedValue({
        reservedRefundMinor: 0,
        successfulRefundMinor: 0,
      }),
      listByOrderId: jest.fn().mockResolvedValue([]),
      findByPaidTerminalIntentKey: jest.fn().mockResolvedValue(null),
      createRefund: jest.fn().mockResolvedValue({
        id: 'refund-1',
        status: 'REQUESTED',
        amountMinor: 1700,
        requestOrigin: REFUND_REQUEST_ORIGIN_CUSTOMER_CANCELLATION,
        requestedByAdminId: null,
        paidTerminalIntentKey: paidTerminalIntentKeyForPayment(paymentId),
      }),
    };
    service = new PaidTerminalRefundService(refunds as never);
  });

  it('derives a deterministic intent key from Payment id', () => {
    expect(paidTerminalIntentKeyForPayment(paymentId)).toBe(
      `paid-terminal:v1:${paymentId}`,
    );
  });

  it('creates Refund intent without Admin impersonation', async () => {
    const view = await service.ensureRefundIntentInTx({} as never, {
      orderId: 'order-1',
      origin: REFUND_REQUEST_ORIGIN_CUSTOMER_CANCELLATION,
      reason: 'Customer cancelled',
    });
    expect(view.created).toBe(true);
    expect(view.refundAmountMinor).toBe(moneyMinorToDecimalString(1700));
    expect(view.requestOrigin).toBe(
      REFUND_REQUEST_ORIGIN_CUSTOMER_CANCELLATION,
    );
    expect(refunds.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedByAdminId: null,
        requestOrigin: REFUND_REQUEST_ORIGIN_CUSTOMER_CANCELLATION,
        paidTerminalIntentKey: paidTerminalIntentKeyForPayment(paymentId),
      }),
      expect.anything(),
    );
  });

  it('reuses existing intent by unique key without rewriting origin', async () => {
    refunds.findByPaidTerminalIntentKey.mockResolvedValue({
      id: 'refund-existing',
      status: 'REQUESTED',
      amountMinor: 1700,
      requestOrigin: REFUND_REQUEST_ORIGIN_LATE_PAYMENT_SUCCESS,
      requestedByAdminId: null,
      paidTerminalIntentKey: paidTerminalIntentKeyForPayment(paymentId),
    });
    const view = await service.ensureRefundIntentInTx({} as never, {
      orderId: 'order-1',
      origin: REFUND_REQUEST_ORIGIN_CUSTOMER_CANCELLATION,
      reason: 'Customer cancelled',
    });
    expect(view.created).toBe(false);
    expect(view.refundId).toBe('refund-existing');
    expect(view.requestOrigin).toBe(REFUND_REQUEST_ORIGIN_LATE_PAYMENT_SUCCESS);
    expect(refunds.createRefund).not.toHaveBeenCalled();
  });

  it('does not treat note text as reuse authority', async () => {
    refunds.listByOrderId.mockResolvedValue([
      {
        id: 'legacy-note',
        status: 'REQUESTED',
        amountMinor: 100,
        requestOrigin: 'ADMIN',
        requestedByAdminId: 'admin-1',
        internalNote: 'paid-terminal-refund-intent',
        reason: 'PAID_TERMINAL:CUSTOMER_CANCEL',
        paidTerminalIntentKey: null,
      },
    ]);
    await service.ensureRefundIntentInTx({} as never, {
      orderId: 'order-1',
      origin: REFUND_REQUEST_ORIGIN_MERCHANT_REJECTION,
      reason: 'Merchant rejected',
    });
    expect(refunds.createRefund).toHaveBeenCalledTimes(1);
  });

  it('fetches existing intent on unique conflict', async () => {
    refunds.createRefund.mockRejectedValue(new Error('unique'));
    (isPostgresUniqueViolation as jest.Mock).mockReturnValue(true);
    refunds.findByPaidTerminalIntentKey
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'refund-race',
        status: 'REQUESTED',
        amountMinor: 1700,
        requestOrigin: REFUND_REQUEST_ORIGIN_MERCHANT_REJECTION,
        requestedByAdminId: null,
        paidTerminalIntentKey: paidTerminalIntentKeyForPayment(paymentId),
      });
    const view = await service.ensureRefundIntentInTx({} as never, {
      orderId: 'order-1',
      origin: REFUND_REQUEST_ORIGIN_CUSTOMER_CANCELLATION,
      reason: 'Customer cancelled',
    });
    expect(view.created).toBe(false);
    expect(view.refundId).toBe('refund-race');
    expect(view.requestOrigin).toBe(REFUND_REQUEST_ORIGIN_MERCHANT_REJECTION);
  });

  it('fails closed for non-electronic Payment', async () => {
    refunds.lockPayment.mockResolvedValue({
      id: paymentId,
      method: 'COD',
      status: 'SUCCEEDED',
      amountMinor: 1700,
      currency: 'DZD',
    });
    await expect(
      service.ensureRefundIntentInTx({} as never, {
        orderId: 'order-1',
        origin: REFUND_REQUEST_ORIGIN_CUSTOMER_CANCELLATION,
        reason: 'x',
      }),
    ).rejects.toMatchObject({
      code: ORDER_ERROR_CODES.ORDER_CANCELLATION_REFUND_REQUIRED,
    });
  });
});
