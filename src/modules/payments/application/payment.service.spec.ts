import { CUSTOMER_ERROR_CODES } from '../../customers/domain/customer.errors';
import { PAYMENT_ERROR_CODES } from '../domain/payment.errors';
import {
  PAYMENT_TX_FAILED,
  PAYMENT_TX_IGNORED,
  PAYMENT_TX_INITIATED,
  PAYMENT_TX_SUCCEEDED,
} from '../domain/payment.policy';
import type {
  PaymentRecord,
  PaymentTransactionRecord,
  ProviderCheckoutSnapshot,
  ProviderSession,
} from '../domain/payment.types';
import { PaymentService } from './payment.service';

const ACCOUNT = '11111111-1111-7111-8111-111111111111';
const OTHER = '22222222-2222-7222-8222-222222222222';
const ORDER_ID = '55555555-5555-7555-8555-555555555555';
const PAYMENT_ID = '66666666-6666-7666-8666-666666666666';
const ATTEMPT_ID = '77777777-7777-7777-8777-777777777777';

function expectCode(error: unknown, code: string): void {
  expect((error as { code: string }).code).toBe(code);
}

function payment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: PAYMENT_ID,
    orderId: ORDER_ID,
    method: 'ELECTRONIC',
    status: 'PENDING',
    amountMinor: 1700,
    currency: 'DZD',
    createdAt: '2026-01-15T12:00:00.000Z',
    updatedAt: '2026-01-15T12:00:00.000Z',
    ...overrides,
  };
}

function attempt(
  overrides: Partial<PaymentTransactionRecord> = {},
): PaymentTransactionRecord {
  return {
    id: ATTEMPT_ID,
    paymentId: PAYMENT_ID,
    provider: 'test',
    providerReference: 'test_ref_1',
    status: PAYMENT_TX_INITIATED,
    amountMinor: 1700,
    idempotencyKey: `init:${PAYMENT_ID}:${ATTEMPT_ID}`,
    processedAt: null,
    createdAt: '2026-01-15T12:00:00.000Z',
    ...overrides,
  };
}

function owned(overrides: Record<string, unknown> = {}) {
  return {
    payment: payment(),
    orderStatus: 'CREATED',
    fulfillmentStatus: 'PENDING_ACCEPTANCE',
    snapshotPayableMinor: 1700,
    snapshotCurrency: 'DZD',
    ...overrides,
  };
}

describe('PaymentService', () => {
  let repo: {
    runInTransaction: jest.Mock;
    findCustomerIdByAccountId: jest.Mock;
    findOwnedPaymentContext: jest.Mock;
    lockPayment: jest.Mock;
    findOpenAttempt: jest.Mock;
    findLatestInitiatedAttempt: jest.Mock;
    findTransactionByIdempotencyKey: jest.Mock;
    findTransactionsByProviderReference: jest.Mock;
    insertCreatedAttempt: jest.Mock;
    markPaymentProcessing: jest.Mock;
    markPaymentPending: jest.Mock;
    markPaymentSucceeded: jest.Mock;
    finalizeInitiated: jest.Mock;
    closeAttempt: jest.Mock;
    insertWebhookTransaction: jest.Mock;
    findOrderStatus: jest.Mock;
  };
  let provider: {
    name: string;
    createPayment: jest.Mock;
    verifyWebhook: jest.Mock;
    parseWebhook: jest.Mock;
    queryPayment: jest.Mock;
  };
  let service: PaymentService;
  let currentPayment: PaymentRecord;
  let openAttempt: PaymentTransactionRecord | null;

  beforeEach(() => {
    currentPayment = payment();
    openAttempt = null;
    repo = {
      runInTransaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      findCustomerIdByAccountId: jest.fn((accountId: string) =>
        Promise.resolve(accountId === ACCOUNT ? 'cust-1' : null),
      ),
      findOwnedPaymentContext: jest.fn(() =>
        Promise.resolve(owned({ payment: currentPayment })),
      ),
      lockPayment: jest.fn(() => Promise.resolve(currentPayment)),
      findOpenAttempt: jest.fn(() => {
        if (
          openAttempt &&
          (openAttempt.status === 'CREATED' ||
            openAttempt.status === PAYMENT_TX_INITIATED) &&
          openAttempt.processedAt == null
        ) {
          return Promise.resolve(openAttempt);
        }
        return Promise.resolve(null);
      }),
      findLatestInitiatedAttempt: jest.fn(() => Promise.resolve(openAttempt)),
      findTransactionByIdempotencyKey: jest.fn(() => Promise.resolve(null)),
      findTransactionsByProviderReference: jest.fn(() =>
        Promise.resolve(openAttempt ? [openAttempt] : []),
      ),
      insertCreatedAttempt: jest.fn((input: { id: string }) => {
        openAttempt = attempt({
          id: input.id,
          status: 'CREATED',
          providerReference: null,
          idempotencyKey: `init:${PAYMENT_ID}:${input.id}`,
        });
        return Promise.resolve(openAttempt);
      }),
      markPaymentProcessing: jest.fn(() => {
        currentPayment = { ...currentPayment, status: 'PROCESSING' };
        return Promise.resolve();
      }),
      markPaymentPending: jest.fn(() => {
        currentPayment = { ...currentPayment, status: 'PENDING' };
        return Promise.resolve();
      }),
      markPaymentSucceeded: jest.fn(() => {
        currentPayment = { ...currentPayment, status: 'SUCCEEDED' };
        return Promise.resolve();
      }),
      finalizeInitiated: jest.fn((_id: string, reference: string) => {
        openAttempt = {
          ...(openAttempt ?? attempt()),
          status: PAYMENT_TX_INITIATED,
          providerReference: reference,
        };
        return Promise.resolve(openAttempt);
      }),
      closeAttempt: jest.fn((_id: string, status: string) => {
        if (openAttempt) {
          openAttempt = { ...openAttempt, status, processedAt: 'now' };
        }
        return Promise.resolve();
      }),
      insertWebhookTransaction: jest.fn(() =>
        Promise.resolve(attempt({ status: 'SUCCEEDED' })),
      ),
      findOrderStatus: jest.fn(() => Promise.resolve('CREATED')),
    };
    provider = {
      name: 'test',
      createPayment: jest.fn((): Promise<ProviderSession> =>
        Promise.resolve({
          provider: 'test',
          providerReference: 'test_ref_1',
          checkoutUrl: 'test://checkout/test_ref_1',
        }),
      ),
      verifyWebhook: jest.fn(() => true),
      parseWebhook: jest.fn(),
      queryPayment: jest.fn((): Promise<ProviderCheckoutSnapshot | null> =>
        Promise.resolve({
          provider: 'test',
          providerReference: 'test_ref_1',
          checkoutUrl: 'test://checkout/test_ref_1',
          providerStatus: 'pending',
          amountMinor: 1700,
          currency: 'DZD',
        }),
      ),
    };
    service = new PaymentService(
      repo as never,
      provider,
      {
        get: jest.fn(() => ''),
      } as never,
      {
        postElectronicPaymentSucceeded: jest.fn().mockResolvedValue({}),
      } as never,
      {
        notifyPaymentSucceeded: jest.fn().mockResolvedValue(undefined),
      } as never,
    );
  });

  it('reads an owned Customer Payment without internal financial fields', async () => {
    const view = await service.getCustomerPayment(ACCOUNT, ORDER_ID);
    expect(view.paymentId).toBe(PAYMENT_ID);
    expect(view.amountMinor).toBe(1700);
    expect(view).not.toHaveProperty('merchantCommissionAmountMinor');
    expect(view).not.toHaveProperty('driverRemunerationMinor');
    expect(view).not.toHaveProperty('checkoutUrl');
  });

  it('returns safe not-found for a foreign Customer', async () => {
    repo.findCustomerIdByAccountId.mockResolvedValue('cust-b');
    repo.findOwnedPaymentContext.mockResolvedValue(null);
    await expect(
      service.getCustomerPayment(OTHER, ORDER_ID),
    ).rejects.toMatchObject({
      code: PAYMENT_ERROR_CODES.PAYMENT_NOT_FOUND,
    });
  });

  it('allows COD Payment reads', async () => {
    currentPayment = payment({ method: 'COD' });
    repo.findOwnedPaymentContext.mockResolvedValue(
      owned({ payment: currentPayment }),
    );
    const view = await service.getCustomerPayment(ACCOUNT, ORDER_ID);
    expect(view.method).toBe('COD');
    expect(view.status).toBe('PENDING');
  });

  it('initiates an owned ELECTRONIC PENDING Payment', async () => {
    const view = await service.initiateCustomerPayment(ACCOUNT, ORDER_ID);
    expect(view.status).toBe('PROCESSING');
    expect(view.attemptId).toBeDefined();
    expect(view.checkoutUrl).toBe('test://checkout/test_ref_1');
    expect(provider.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ amountMinor: 1700, currency: 'DZD' }),
    );
  });

  it('blocks COD initiation', async () => {
    currentPayment = payment({ method: 'COD' });
    repo.findOwnedPaymentContext.mockResolvedValue(
      owned({ payment: currentPayment }),
    );
    await expect(
      service.initiateCustomerPayment(ACCOUNT, ORDER_ID),
    ).rejects.toMatchObject({
      code: PAYMENT_ERROR_CODES.PAYMENT_METHOD_NOT_ELECTRONIC,
    });
    expect(provider.createPayment).not.toHaveBeenCalled();
  });

  it('blocks already SUCCEEDED Payments', async () => {
    currentPayment = payment({ status: 'SUCCEEDED' });
    repo.findOwnedPaymentContext.mockResolvedValue(
      owned({ payment: currentPayment }),
    );
    await expect(
      service.initiateCustomerPayment(ACCOUNT, ORDER_ID),
    ).rejects.toMatchObject({
      code: PAYMENT_ERROR_CODES.PAYMENT_ALREADY_SUCCEEDED,
    });
  });

  it('blocks cancelled or terminal Orders', async () => {
    currentPayment = payment();
    repo.findOwnedPaymentContext.mockResolvedValue(
      owned({ payment: currentPayment, orderStatus: 'CANCELLED' }),
    );
    await expect(
      service.initiateCustomerPayment(ACCOUNT, ORDER_ID),
    ).rejects.toMatchObject({
      code: PAYMENT_ERROR_CODES.PAYMENT_NOT_INITIABLE,
    });
  });

  it('fails closed when Payment and snapshot amounts diverge', async () => {
    repo.findOwnedPaymentContext.mockResolvedValue(
      owned({ snapshotPayableMinor: 9999 }),
    );
    await expect(
      service.initiateCustomerPayment(ACCOUNT, ORDER_ID),
    ).rejects.toMatchObject({
      code: PAYMENT_ERROR_CODES.PAYMENT_AMOUNT_MISMATCH,
    });
    expect(provider.createPayment).not.toHaveBeenCalled();
  });

  it('fails closed on currency mismatch', async () => {
    currentPayment = payment({ currency: 'USD' });
    repo.findOwnedPaymentContext.mockResolvedValue(
      owned({ payment: currentPayment, snapshotCurrency: 'USD' }),
    );
    await expect(
      service.initiateCustomerPayment(ACCOUNT, ORDER_ID),
    ).rejects.toMatchObject({
      code: PAYMENT_ERROR_CODES.PAYMENT_CURRENCY_MISMATCH,
    });
  });

  it('reuses an open INITIATED attempt instead of creating another', async () => {
    openAttempt = attempt();
    currentPayment = payment({ status: 'PROCESSING' });
    repo.findOwnedPaymentContext.mockResolvedValue(
      owned({ payment: currentPayment }),
    );
    const first = await service.initiateCustomerPayment(ACCOUNT, ORDER_ID);
    const second = await service.initiateCustomerPayment(ACCOUNT, ORDER_ID);
    expect(first.attemptId).toBe(second.attemptId);
    expect(repo.insertCreatedAttempt).not.toHaveBeenCalled();
    expect(provider.createPayment).not.toHaveBeenCalled();
  });

  it('does not mark success when the provider is unavailable', async () => {
    provider.createPayment.mockRejectedValue(new Error('timeout'));
    await expect(
      service.initiateCustomerPayment(ACCOUNT, ORDER_ID),
    ).rejects.toMatchObject({
      code: PAYMENT_ERROR_CODES.PAYMENT_PROVIDER_UNAVAILABLE,
    });
    expect(repo.markPaymentSucceeded).not.toHaveBeenCalled();
    expect(repo.closeAttempt).toHaveBeenCalledWith(
      expect.any(String),
      PAYMENT_TX_FAILED,
      expect.anything(),
    );
    expect(currentPayment.status).toBe('PENDING');
  });

  it('applies a verified success webhook without mutating Order state', async () => {
    openAttempt = attempt();
    currentPayment = payment({ status: 'PROCESSING' });
    provider.parseWebhook.mockReturnValue({
      eventId: 'evt-1',
      providerReference: 'test_ref_1',
      status: 'SUCCEEDED',
      amountMinor: 1700,
      currency: 'DZD',
    });
    const result = await service.handleProviderWebhook(
      'test',
      Buffer.from('{}'),
      'sha256=ok',
    );
    expect(result).toEqual({ accepted: true });
    expect(repo.markPaymentSucceeded).toHaveBeenCalled();
    expect(currentPayment.status).toBe('SUCCEEDED');
    expect(repo.insertWebhookTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        status: PAYMENT_TX_SUCCEEDED,
        idempotencyKey: 'wh:test:evt-1',
      }),
      expect.anything(),
    );
  });

  it('does not mutate Payment on an invalid signature', async () => {
    provider.verifyWebhook.mockReturnValue(false);
    await expect(
      service.handleProviderWebhook('test', Buffer.from('{}'), 'bad'),
    ).rejects.toMatchObject({
      code: PAYMENT_ERROR_CODES.PAYMENT_WEBHOOK_INVALID_SIGNATURE,
    });
    expect(repo.markPaymentSucceeded).not.toHaveBeenCalled();
    expect(repo.insertWebhookTransaction).not.toHaveBeenCalled();
  });

  it('rejects an unknown provider reference', async () => {
    provider.parseWebhook.mockReturnValue({
      eventId: 'evt-unknown',
      eventType: 'checkout.paid',
      providerReference: 'missing',
      status: 'SUCCEEDED',
      amountMinor: 1700,
      currency: 'DZD',
    });
    repo.findTransactionsByProviderReference.mockResolvedValue([]);
    await expect(
      service.handleProviderWebhook('test', Buffer.from('{}'), 'sha256=ok'),
    ).rejects.toMatchObject({
      code: PAYMENT_ERROR_CODES.PAYMENT_WEBHOOK_UNKNOWN_REFERENCE,
    });
    expect(repo.markPaymentSucceeded).not.toHaveBeenCalled();
  });

  it('does not succeed when the webhook amount is tampered', async () => {
    openAttempt = attempt();
    currentPayment = payment({ status: 'PROCESSING' });
    provider.parseWebhook.mockReturnValue({
      eventId: 'evt-tamper',
      eventType: 'checkout.paid',
      providerReference: 'test_ref_1',
      status: 'SUCCEEDED',
      amountMinor: 1,
      currency: 'DZD',
    });
    await service.handleProviderWebhook('test', Buffer.from('{}'), 'sha256=ok');
    expect(repo.markPaymentSucceeded).not.toHaveBeenCalled();
    expect(repo.insertWebhookTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ status: PAYMENT_TX_IGNORED }),
      expect.anything(),
    );
    expect(currentPayment.status).toBe('PROCESSING');
  });

  it('is idempotent for the same success event', async () => {
    openAttempt = attempt();
    currentPayment = payment({ status: 'SUCCEEDED' });
    repo.findTransactionByIdempotencyKey.mockResolvedValue(
      attempt({
        status: PAYMENT_TX_SUCCEEDED,
        idempotencyKey: 'wh:test:evt-1',
      }),
    );
    provider.parseWebhook.mockReturnValue({
      eventId: 'evt-1',
      providerReference: 'test_ref_1',
      status: 'SUCCEEDED',
      amountMinor: 1700,
      currency: 'DZD',
    });
    await service.handleProviderWebhook('test', Buffer.from('{}'), 'sha256=ok');
    expect(repo.markPaymentSucceeded).not.toHaveBeenCalled();
    expect(repo.insertWebhookTransaction).not.toHaveBeenCalled();
  });

  it('does not regress SUCCEEDED after an older failure', async () => {
    openAttempt = attempt({ status: PAYMENT_TX_SUCCEEDED, processedAt: 'now' });
    currentPayment = payment({ status: 'SUCCEEDED' });
    provider.parseWebhook.mockReturnValue({
      eventId: 'evt-old-fail',
      eventType: 'checkout.failed',
      providerReference: 'test_ref_1',
      status: 'FAILED',
      amountMinor: 1700,
      currency: 'DZD',
    });
    await service.handleProviderWebhook('test', Buffer.from('{}'), 'sha256=ok');
    expect(currentPayment.status).toBe('SUCCEEDED');
    expect(repo.markPaymentPending).not.toHaveBeenCalled();
    expect(repo.insertWebhookTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ status: PAYMENT_TX_IGNORED }),
      expect.anything(),
    );
  });

  it('records late verified success against a terminal Order without resurrecting it', async () => {
    openAttempt = attempt({ status: 'CANCELLED', processedAt: 'now' });
    currentPayment = payment({ status: 'CANCELLED' });
    repo.findOrderStatus.mockResolvedValue('CANCELLED');
    repo.findOwnedPaymentContext.mockResolvedValue(
      owned({ payment: currentPayment, orderStatus: 'CANCELLED' }),
    );
    provider.parseWebhook.mockReturnValue({
      eventId: 'evt-late',
      eventType: 'checkout.paid',
      providerReference: 'test_ref_1',
      status: 'SUCCEEDED',
      amountMinor: 1700,
      currency: 'DZD',
    });
    await service.handleProviderWebhook('test', Buffer.from('{}'), 'sha256=ok');
    expect(repo.markPaymentSucceeded).toHaveBeenCalled();
    expect(currentPayment.status).toBe('SUCCEEDED');
    expect(repo.findOwnedPaymentContext).not.toHaveBeenCalled();
  });

  it('never marks a COD Payment SUCCEEDED from a webhook', async () => {
    openAttempt = attempt();
    currentPayment = payment({ method: 'COD', status: 'PENDING' });
    provider.parseWebhook.mockReturnValue({
      eventId: 'evt-cod',
      eventType: 'checkout.paid',
      providerReference: 'test_ref_1',
      status: 'SUCCEEDED',
      amountMinor: 1700,
      currency: 'DZD',
    });
    await service.handleProviderWebhook('test', Buffer.from('{}'), 'sha256=ok');
    expect(repo.markPaymentSucceeded).not.toHaveBeenCalled();
    expect(currentPayment.status).toBe('PENDING');
  });

  it('returns customer-profile not found when the Account has no Customer', async () => {
    repo.findCustomerIdByAccountId.mockResolvedValue(null);
    try {
      await service.getCustomerPayment(ACCOUNT, ORDER_ID);
      throw new Error('expected failure');
    } catch (error) {
      expectCode(error, CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND);
    }
  });

  it('fails closed when the same providerReference belongs to another Payment', async () => {
    repo.findTransactionsByProviderReference.mockResolvedValue([
      attempt({
        paymentId: 'other-payment',
        providerReference: 'test_ref_1',
      }),
    ]);
    await expect(
      service.initiateCustomerPayment(ACCOUNT, ORDER_ID),
    ).rejects.toMatchObject({
      code: PAYMENT_ERROR_CODES.PAYMENT_INVALID_STATE,
    });
    expect(repo.markPaymentSucceeded).not.toHaveBeenCalled();
  });

  it('fails closed on an ambiguous webhook providerReference', async () => {
    openAttempt = attempt();
    currentPayment = payment({ status: 'PROCESSING' });
    repo.findTransactionsByProviderReference.mockResolvedValue([
      attempt(),
      attempt({
        id: '88888888-8888-7888-8888-888888888888',
        paymentId: 'other-payment',
      }),
    ]);
    provider.parseWebhook.mockReturnValue({
      eventId: 'evt-collision',
      eventType: 'checkout.paid',
      providerReference: 'test_ref_1',
      status: 'SUCCEEDED',
      amountMinor: 1700,
      currency: 'DZD',
    });
    await expect(
      service.handleProviderWebhook('test', Buffer.from('{}'), 'sha256=ok'),
    ).rejects.toMatchObject({
      code: PAYMENT_ERROR_CODES.PAYMENT_INVALID_STATE,
    });
    expect(repo.markPaymentSucceeded).not.toHaveBeenCalled();
    expect(repo.insertWebhookTransaction).not.toHaveBeenCalled();
  });

  it('reuses an INITIATED pending checkout without creating another', async () => {
    openAttempt = attempt();
    currentPayment = payment({ status: 'PROCESSING' });
    repo.findOwnedPaymentContext.mockResolvedValue(
      owned({ payment: currentPayment }),
    );
    const view = await service.initiateCustomerPayment(ACCOUNT, ORDER_ID);
    expect(view.attemptId).toBe(ATTEMPT_ID);
    expect(view.checkoutUrl).toBe('test://checkout/test_ref_1');
    expect(provider.createPayment).not.toHaveBeenCalled();
    expect(provider.queryPayment).toHaveBeenCalledWith({
      providerReference: 'test_ref_1',
    });
  });

  it('reconciles a missed paid checkout on re-initiate', async () => {
    openAttempt = attempt();
    currentPayment = payment({ status: 'PROCESSING' });
    repo.findOwnedPaymentContext.mockResolvedValue(
      owned({ payment: currentPayment }),
    );
    provider.queryPayment.mockResolvedValue({
      provider: 'test',
      providerReference: 'test_ref_1',
      checkoutUrl: 'test://checkout/test_ref_1',
      providerStatus: 'paid',
      amountMinor: 1700,
      currency: 'DZD',
    });
    const view = await service.initiateCustomerPayment(ACCOUNT, ORDER_ID);
    expect(view.status).toBe('SUCCEEDED');
    expect(repo.markPaymentSucceeded).toHaveBeenCalled();
    expect(provider.createPayment).not.toHaveBeenCalled();
  });

  it('closes a canceled checkout and allows a new attempt', async () => {
    openAttempt = attempt();
    currentPayment = payment({ status: 'PROCESSING' });
    repo.findOwnedPaymentContext.mockResolvedValue(
      owned({ payment: currentPayment }),
    );
    provider.queryPayment.mockResolvedValue({
      provider: 'test',
      providerReference: 'test_ref_1',
      checkoutUrl: 'test://checkout/test_ref_1',
      providerStatus: 'canceled',
      amountMinor: 1700,
      currency: 'DZD',
    });
    const view = await service.initiateCustomerPayment(ACCOUNT, ORDER_ID);
    expect(repo.closeAttempt).toHaveBeenCalledWith(
      ATTEMPT_ID,
      'CANCELLED',
      expect.anything(),
    );
    expect(provider.createPayment).toHaveBeenCalled();
    expect(view.status).toBe('PROCESSING');
    expect(view.attemptId).not.toBe(ATTEMPT_ID);
  });

  it('closes a failed checkout and allows a new attempt', async () => {
    openAttempt = attempt();
    currentPayment = payment({ status: 'PROCESSING' });
    repo.findOwnedPaymentContext.mockResolvedValue(
      owned({ payment: currentPayment }),
    );
    provider.queryPayment.mockResolvedValue({
      provider: 'test',
      providerReference: 'test_ref_1',
      checkoutUrl: 'test://checkout/test_ref_1',
      providerStatus: 'failed',
      amountMinor: 1700,
      currency: 'DZD',
    });
    await service.initiateCustomerPayment(ACCOUNT, ORDER_ID);
    expect(repo.closeAttempt).toHaveBeenCalledWith(
      ATTEMPT_ID,
      PAYMENT_TX_FAILED,
      expect.anything(),
    );
    expect(provider.createPayment).toHaveBeenCalled();
  });

  it('ignores an unsupported signed event without mutating Payment', async () => {
    openAttempt = attempt();
    currentPayment = payment({ status: 'PROCESSING' });
    provider.parseWebhook.mockReturnValue({
      eventId: 'evt-unknown-type',
      eventType: 'checkout.updated',
      providerReference: 'test_ref_1',
      status: 'UNSUPPORTED',
      amountMinor: 1700,
      currency: 'DZD',
    });
    await service.handleProviderWebhook('test', Buffer.from('{}'), 'sha256=ok');
    expect(repo.markPaymentSucceeded).not.toHaveBeenCalled();
    expect(repo.markPaymentPending).not.toHaveBeenCalled();
    expect(repo.insertWebhookTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ status: PAYMENT_TX_IGNORED }),
      expect.anything(),
    );
  });

  it('allows verified success to move FAILED to SUCCEEDED', async () => {
    openAttempt = attempt({ status: PAYMENT_TX_FAILED, processedAt: 'now' });
    currentPayment = payment({ status: 'FAILED' });
    provider.parseWebhook.mockReturnValue({
      eventId: 'evt-late-failed',
      eventType: 'checkout.paid',
      providerReference: 'test_ref_1',
      status: 'SUCCEEDED',
      amountMinor: 1700,
      currency: 'DZD',
    });
    await service.handleProviderWebhook('test', Buffer.from('{}'), 'sha256=ok');
    expect(repo.markPaymentSucceeded).toHaveBeenCalled();
    expect(currentPayment.status).toBe('SUCCEEDED');
  });
});
