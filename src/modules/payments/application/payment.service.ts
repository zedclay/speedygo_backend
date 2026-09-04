import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import { isPostgresUniqueViolation } from '../../../common/errors/postgres-unique';
import { customerProfileNotFound } from '../../customers/domain/customer.errors';
import {
  PAYMENT_STATUS_FAILED,
  PAYMENT_STATUS_PENDING,
  PAYMENT_STATUS_PROCESSING,
} from '../../orders/domain/order.policy';
import {
  PaymentError,
  paymentAlreadySucceeded,
  paymentAmountMismatch,
  paymentCurrencyMismatch,
  paymentInvalidState,
  paymentMethodNotElectronic,
  paymentNotFound,
  paymentNotInitiable,
  paymentProviderUnavailable,
  paymentWebhookInvalidSignature,
  paymentWebhookUnknownReference,
} from '../domain/payment.errors';
import {
  amountsMatch,
  initiationIdempotencyKey,
  isElectronicMethod,
  isFrozenCurrency,
  isPaymentCancelled,
  isPaymentExecutionTerminal,
  isPaymentInitiableOrderStatus,
  PAYMENT_TX_CANCELLED,
  PAYMENT_TX_CREATED,
  PAYMENT_TX_FAILED,
  PAYMENT_TX_IGNORED,
  PAYMENT_TX_INITIATED,
  PAYMENT_TX_SUCCEEDED,
  uniquePaymentIds,
  webhookIdempotencyKey,
} from '../domain/payment.policy';
import type { PaymentProvider } from '../domain/ports/payment-provider.port';
import {
  PAYMENT_PROVIDER,
  type CustomerPaymentView,
  type PaymentInitiateView,
  type PaymentRecord,
  type PaymentTransactionRecord,
  type ProviderCheckoutSnapshot,
  type ProviderSession,
  type ProviderWebhookEvent,
} from '../domain/payment.types';
import { PaymentRepository } from '../infrastructure/payment.repository';
import { FinancialLedgerService } from '../../financial-ledger/application/financial-ledger.service';
import { NotificationService } from '../../notifications/application/notification.service';

type PreparedInitiation =
  | { kind: 'reuse'; payment: PaymentRecord; attempt: PaymentTransactionRecord }
  | {
      kind: 'recover';
      payment: PaymentRecord;
      attempt: PaymentTransactionRecord;
    }
  | {
      kind: 'created';
      payment: PaymentRecord;
      attempt: PaymentTransactionRecord;
    };

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly payments: PaymentRepository,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly config: ConfigService,
    private readonly ledger: FinancialLedgerService,
    private readonly notifications: NotificationService,
  ) {}

  async getCustomerPayment(
    accountId: string,
    orderId: string,
  ): Promise<CustomerPaymentView> {
    const context = await this.requireOwnedContext(accountId, orderId);
    return this.toCustomerView(context.payment, this.provider.name);
  }

  async initiateCustomerPayment(
    accountId: string,
    orderId: string,
  ): Promise<PaymentInitiateView> {
    const prepared = await this.prepareInitiation(accountId, orderId);
    if (prepared.kind === 'reuse') {
      return this.continueInitiatedAttempt(accountId, orderId, prepared);
    }
    return this.executeProviderCreate(prepared);
  }

  async handleProviderWebhook(
    providerName: string,
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<{ accepted: true }> {
    if (providerName !== this.provider.name) {
      throw paymentWebhookUnknownReference();
    }
    if (!rawBody || !this.provider.verifyWebhook(rawBody, signature)) {
      throw paymentWebhookInvalidSignature();
    }
    const event = this.provider.parseWebhook(rawBody);
    this.logger.log(
      `payment webhook accepted provider=${this.provider.name} eventId=${event.eventId} eventType=${event.eventType} providerReference=${event.providerReference} result=${event.status}`,
    );
    await this.applyVerifiedWebhook(event);
    return { accepted: true };
  }

  private async requireOwnedContext(accountId: string, orderId: string) {
    const customerId = await this.payments.findCustomerIdByAccountId(accountId);
    if (!customerId) {
      throw customerProfileNotFound();
    }
    const context = await this.payments.findOwnedPaymentContext(
      customerId,
      orderId,
    );
    if (!context) {
      throw paymentNotFound();
    }
    return context;
  }

  private async prepareInitiation(
    accountId: string,
    orderId: string,
  ): Promise<PreparedInitiation> {
    return this.payments.runInTransaction(async (tx) => {
      const customerId =
        await this.payments.findCustomerIdByAccountId(accountId);
      if (!customerId) {
        throw customerProfileNotFound();
      }
      const owned = await this.payments.findOwnedPaymentContext(
        customerId,
        orderId,
        tx,
      );
      if (!owned) {
        throw paymentNotFound();
      }
      const payment = await this.payments.lockPayment(owned.payment.id, tx);
      if (!payment) {
        throw paymentNotFound();
      }
      this.assertInitiationEligibility(payment, owned);
      const open = await this.payments.findOpenAttempt(payment.id, tx);
      if (open?.status === PAYMENT_TX_INITIATED && open.providerReference) {
        return { kind: 'reuse', payment, attempt: open };
      }
      if (open?.status === PAYMENT_TX_CREATED) {
        return { kind: 'recover', payment, attempt: open };
      }
      const attemptId = createUuidV7();
      const attempt = await this.payments.insertCreatedAttempt(
        {
          id: attemptId,
          paymentId: payment.id,
          provider: this.provider.name,
          amountMinor: payment.amountMinor,
          idempotencyKey: initiationIdempotencyKey(payment.id, attemptId),
        },
        tx,
      );
      await this.payments.markPaymentProcessing(payment.id, tx);
      return {
        kind: 'created',
        payment: { ...payment, status: PAYMENT_STATUS_PROCESSING },
        attempt,
      };
    });
  }

  private assertInitiationEligibility(
    payment: PaymentRecord,
    owned: {
      orderStatus: string;
      snapshotPayableMinor: number;
      snapshotCurrency: string;
    },
  ): void {
    if (isPaymentExecutionTerminal(payment.status)) {
      throw paymentAlreadySucceeded();
    }
    if (!isElectronicMethod(payment.method)) {
      throw paymentMethodNotElectronic();
    }
    if (
      isPaymentCancelled(payment.status) ||
      !isPaymentInitiableOrderStatus(owned.orderStatus)
    ) {
      throw paymentNotInitiable();
    }
    if (
      payment.status !== PAYMENT_STATUS_PENDING &&
      payment.status !== PAYMENT_STATUS_PROCESSING &&
      payment.status !== PAYMENT_STATUS_FAILED
    ) {
      throw paymentNotInitiable();
    }
    if (
      !isFrozenCurrency(payment.currency) ||
      !isFrozenCurrency(owned.snapshotCurrency)
    ) {
      throw paymentCurrencyMismatch();
    }
    if (!amountsMatch(payment.amountMinor, owned.snapshotPayableMinor)) {
      throw paymentAmountMismatch();
    }
  }

  private async continueInitiatedAttempt(
    accountId: string,
    orderId: string,
    prepared: {
      payment: PaymentRecord;
      attempt: PaymentTransactionRecord;
    },
  ): Promise<PaymentInitiateView> {
    const reference = prepared.attempt.providerReference;
    if (!reference) {
      return this.executeProviderCreate({
        payment: prepared.payment,
        attempt: prepared.attempt,
      });
    }
    const queried = await this.provider.queryPayment({
      providerReference: reference,
    });
    if (!queried) {
      throw paymentProviderUnavailable();
    }
    if (
      queried.providerStatus === 'pending' ||
      queried.providerStatus === 'processing'
    ) {
      return this.toInitiateView(
        prepared.payment,
        prepared.attempt,
        queried.checkoutUrl,
      );
    }
    if (queried.providerStatus === 'paid') {
      await this.reconcilePaidSnapshot(
        prepared.payment,
        prepared.attempt,
        queried,
      );
      return this.toInitiateView(
        { ...prepared.payment, status: 'SUCCEEDED' },
        prepared.attempt,
        null,
      );
    }
    await this.closeAttemptFromProvider(
      prepared.attempt,
      queried.providerStatus === 'canceled'
        ? PAYMENT_TX_CANCELLED
        : PAYMENT_TX_FAILED,
    );
    const next = await this.prepareInitiation(accountId, orderId);
    if (next.kind === 'reuse') {
      return this.continueInitiatedAttempt(accountId, orderId, next);
    }
    return this.executeProviderCreate(next);
  }

  private async executeProviderCreate(prepared: {
    payment: PaymentRecord;
    attempt: PaymentTransactionRecord;
  }): Promise<PaymentInitiateView> {
    const session = await this.createProviderSession(
      prepared.attempt,
      prepared.payment,
    );
    const finalized = await this.finalizeProviderSession(
      prepared.payment,
      prepared.attempt,
      session,
    );
    return this.toInitiateView(
      finalized.payment,
      finalized.attempt,
      session.checkoutUrl,
    );
  }

  private async createProviderSession(
    attempt: PaymentTransactionRecord,
    payment: PaymentRecord,
  ): Promise<ProviderSession> {
    try {
      return await this.provider.createPayment({
        amountMinor: attempt.amountMinor,
        currency: 'DZD',
        idempotencyKey: attempt.idempotencyKey,
        returnUrl: this.config.get<string>('payments.returnUrl', ''),
        cancelUrl: this.config.get<string>('payments.cancelUrl', ''),
        webhookUrl: this.config.get<string>('payments.webhookUrl', ''),
        paymentId: payment.id,
        attemptId: attempt.id,
      });
    } catch (error) {
      await this.failOpenAttempt(attempt);
      if (
        error instanceof PaymentError &&
        error.code === 'PAYMENT_PROVIDER_CONFIGURATION_INVALID'
      ) {
        throw error;
      }
      throw paymentProviderUnavailable();
    }
  }

  private async failOpenAttempt(
    attempt: PaymentTransactionRecord,
  ): Promise<void> {
    await this.closeAttemptFromProvider(attempt, PAYMENT_TX_FAILED);
  }

  private async closeAttemptFromProvider(
    attempt: PaymentTransactionRecord,
    status: string,
  ): Promise<void> {
    await this.payments.runInTransaction(async (tx) => {
      await this.payments.closeAttempt(attempt.id, status, tx);
      const locked = await this.payments.lockPayment(attempt.paymentId, tx);
      if (
        locked &&
        !isPaymentExecutionTerminal(locked.status) &&
        locked.status === PAYMENT_STATUS_PROCESSING
      ) {
        await this.payments.markPaymentPending(attempt.paymentId, tx);
      }
    });
  }

  private async finalizeProviderSession(
    payment: PaymentRecord,
    attempt: PaymentTransactionRecord,
    session: ProviderSession,
  ): Promise<{ payment: PaymentRecord; attempt: PaymentTransactionRecord }> {
    try {
      return await this.payments.runInTransaction(async (tx) => {
        this.assertUniqueProviderReference(
          await this.payments.findTransactionsByProviderReference(
            session.providerReference,
            tx,
          ),
          payment.id,
          attempt.id,
        );
        const finalized = await this.payments.finalizeInitiated(
          attempt.id,
          session.providerReference,
          tx,
        );
        if (!finalized) {
          throw paymentProviderUnavailable();
        }
        const current = await this.payments.lockPayment(payment.id, tx);
        return {
          payment: current ?? { ...payment, status: PAYMENT_STATUS_PROCESSING },
          attempt: finalized,
        };
      });
    } catch (error) {
      if (
        error instanceof PaymentError &&
        error.code === 'PAYMENT_INVALID_STATE'
      ) {
        await this.failOpenAttempt(attempt);
      }
      throw error;
    }
  }

  private assertUniqueProviderReference(
    matches: PaymentTransactionRecord[],
    paymentId: string,
    attemptId?: string,
  ): void {
    const foreign = matches.filter((row) => row.paymentId !== paymentId);
    if (foreign.length > 0) {
      throw paymentInvalidState();
    }
    if (uniquePaymentIds(matches).length > 1) {
      throw paymentInvalidState();
    }
    const otherAttempt = matches.find(
      (row) =>
        row.paymentId === paymentId &&
        attemptId !== undefined &&
        row.id !== attemptId &&
        row.status === PAYMENT_TX_INITIATED,
    );
    if (otherAttempt) {
      throw paymentInvalidState();
    }
  }

  private async reconcilePaidSnapshot(
    payment: PaymentRecord,
    attempt: PaymentTransactionRecord,
    snapshot: ProviderCheckoutSnapshot,
  ): Promise<void> {
    if (
      snapshot.amountMinor !== payment.amountMinor ||
      !isFrozenCurrency(snapshot.currency)
    ) {
      throw paymentAmountMismatch();
    }
    await this.payments.runInTransaction(async (tx) => {
      const matches = await this.payments.findTransactionsByProviderReference(
        snapshot.providerReference,
        tx,
      );
      if (uniquePaymentIds(matches).length > 1) {
        throw paymentInvalidState();
      }
      const locked = await this.payments.lockPayment(payment.id, tx);
      if (!locked || !isElectronicMethod(locked.method)) {
        throw paymentInvalidState();
      }
      if (!isPaymentExecutionTerminal(locked.status)) {
        await this.payments.markPaymentSucceeded(payment.id, tx);
      }
      if (isOpenish(attempt.status)) {
        await this.payments.closeAttempt(attempt.id, PAYMENT_TX_SUCCEEDED, tx);
      }
      await this.ledger.postElectronicPaymentSucceeded(
        {
          paymentId: locked.id,
          orderId: locked.orderId,
          amountMinor: locked.amountMinor,
          currency: locked.currency,
        },
        tx,
      );
    });
    await this.notifications.notifyPaymentSucceeded({
      paymentId: payment.id,
    });
  }

  private async applyVerifiedWebhook(
    event: ProviderWebhookEvent,
  ): Promise<void> {
    const idempotencyKey = webhookIdempotencyKey(
      this.provider.name,
      event.eventId,
    );
    let succeededPaymentId: string | null = null;
    try {
      await this.payments.runInTransaction(async (tx) => {
        const existing = await this.payments.findTransactionByIdempotencyKey(
          idempotencyKey,
          tx,
        );
        if (existing) {
          return;
        }
        const matches = await this.payments.findTransactionsByProviderReference(
          event.providerReference,
          tx,
        );
        if (matches.length === 0) {
          throw paymentWebhookUnknownReference();
        }
        const paymentIds = uniquePaymentIds(matches);
        if (paymentIds.length !== 1) {
          throw paymentInvalidState();
        }
        const payment = await this.payments.lockPayment(paymentIds[0], tx);
        if (!payment) {
          throw paymentWebhookUnknownReference();
        }
        const correlatingAttempt = matches.find(
          (row) =>
            !row.idempotencyKey.startsWith('wh:') &&
            row.providerReference === event.providerReference,
        );
        const amountOk =
          event.amountMinor === payment.amountMinor &&
          Number.isInteger(event.amountMinor);
        const currencyOk = isFrozenCurrency(event.currency);
        let recordedStatus = PAYMENT_TX_IGNORED;
        if (event.status === 'UNSUPPORTED') {
          recordedStatus = PAYMENT_TX_IGNORED;
        } else if (
          !amountOk ||
          !currencyOk ||
          !isElectronicMethod(payment.method)
        ) {
          recordedStatus = PAYMENT_TX_IGNORED;
        } else if (event.status === 'SUCCEEDED') {
          recordedStatus = PAYMENT_TX_SUCCEEDED;
          if (!isPaymentExecutionTerminal(payment.status)) {
            await this.payments.markPaymentSucceeded(payment.id, tx);
          }
          if (
            correlatingAttempt &&
            correlatingAttempt.status !== PAYMENT_TX_SUCCEEDED
          ) {
            await this.payments.closeAttempt(
              correlatingAttempt.id,
              PAYMENT_TX_SUCCEEDED,
              tx,
            );
          }
          await this.ledger.postElectronicPaymentSucceeded(
            {
              paymentId: payment.id,
              orderId: payment.orderId,
              amountMinor: payment.amountMinor,
              currency: payment.currency,
            },
            tx,
          );
        } else if (isPaymentExecutionTerminal(payment.status)) {
          recordedStatus = PAYMENT_TX_IGNORED;
        } else if (event.status === 'CANCELLED') {
          recordedStatus = PAYMENT_TX_CANCELLED;
          if (correlatingAttempt && isOpenish(correlatingAttempt.status)) {
            await this.payments.closeAttempt(
              correlatingAttempt.id,
              PAYMENT_TX_CANCELLED,
              tx,
            );
          }
          if (payment.status === PAYMENT_STATUS_PROCESSING) {
            await this.payments.markPaymentPending(payment.id, tx);
          }
        } else {
          recordedStatus = PAYMENT_TX_FAILED;
          if (correlatingAttempt && isOpenish(correlatingAttempt.status)) {
            await this.payments.closeAttempt(
              correlatingAttempt.id,
              PAYMENT_TX_FAILED,
              tx,
            );
          }
          if (payment.status === PAYMENT_STATUS_PROCESSING) {
            await this.payments.markPaymentPending(payment.id, tx);
          }
        }
        this.logger.log(
          `payment webhook applied paymentId=${payment.id} eventId=${event.eventId} recorded=${recordedStatus}`,
        );
        await this.payments.insertWebhookTransaction(
          {
            paymentId: payment.id,
            provider: this.provider.name,
            providerReference: event.providerReference,
            status: recordedStatus,
            amountMinor: payment.amountMinor,
            idempotencyKey,
          },
          tx,
        );
        if (recordedStatus === PAYMENT_TX_SUCCEEDED) {
          succeededPaymentId = payment.id;
        }
      });
      if (succeededPaymentId) {
        await this.notifications.notifyPaymentSucceeded({
          paymentId: succeededPaymentId,
        });
      }
    } catch (error) {
      if (isPostgresUniqueViolation(error)) {
        return;
      }
      throw error;
    }
  }

  private toCustomerView(
    payment: PaymentRecord,
    provider: string | null,
  ): CustomerPaymentView {
    return {
      paymentId: payment.id,
      method: payment.method,
      status: payment.status,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      provider: payment.method === 'ELECTRONIC' ? provider : null,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }

  private toInitiateView(
    payment: PaymentRecord,
    attempt: PaymentTransactionRecord,
    checkoutUrl: string | null,
  ): PaymentInitiateView {
    return {
      ...this.toCustomerView(payment, attempt.provider),
      attemptId: attempt.id,
      checkoutUrl,
    };
  }
}

function isOpenish(status: string): boolean {
  return status === PAYMENT_TX_CREATED || status === PAYMENT_TX_INITIATED;
}
