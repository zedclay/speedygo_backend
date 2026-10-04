import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  MATCHING_JOBS,
  type MatchingJobs,
} from '../../matching/domain/matching.jobs';
import { MerchantAccessService } from '../../merchants/application/merchant-access.service';
import {
  merchantBranchNotFound,
  merchantStatusRestricted,
} from '../../merchants/domain/merchant.errors';
import {
  isMerchantApproved,
  MERCHANT_CAPABILITIES,
  merchantFinanceAccess,
  parseMerchantMemberRole,
} from '../../merchants/domain/merchant.policy';
import { NotificationService } from '../../notifications/application/notification.service';
import { PaidTerminalRefundService } from '../../refunds/application/paid-terminal-refund.service';
import { REFUND_REQUEST_ORIGIN_MERCHANT_REJECTION } from '../../refunds/domain/refund.types';
import { PAID_TERMINAL_REASON_MERCHANT_REJECT } from '../domain/customer-order-cancellation.policy';
import {
  merchantOrderAlreadyAccepted,
  merchantOrderInvalidTransition,
  merchantOrderNotFound,
  merchantOrderNotRejectable,
  merchantOrderPaymentNotReady,
  merchantOrderPrepEstimateConflict,
  merchantOrderPrepEstimateInvalid,
  merchantOrderPrepEstimateNotAllowed,
} from '../domain/order.errors';
import {
  inspectMerchantWorkflowTransition,
  merchantPreparationPaymentReady,
  MERCHANT_REJECTION_REASON_MAX_LENGTH,
  normalizeOrderListQuery,
  PAYMENT_STATUS_FAILED,
  PAYMENT_STATUS_PENDING,
  PAYMENT_STATUS_PROCESSING,
  PAYMENT_STATUS_SUCCEEDED,
  type MerchantWorkflowAction,
} from '../domain/order.policy';
import {
  PREPARATION_ADD_MINUTES_MAX,
  PREPARATION_ADD_MINUTES_MIN,
  PREPARATION_ESTIMATE_REASON_MAX,
  PREPARATION_MINUTES_MAX,
  PREPARATION_MINUTES_MIN,
  isEligibleFulfillmentForPrepEstimateUpdate,
} from '../domain/preparation-estimate.policy';
import {
  isMerchantCancellationReasonCode,
  type MerchantCancellationReasonCode,
} from '../domain/merchant-cancellation-reason';
import { projectMerchantOrderForRole } from '../domain/merchant-order-visibility.policy';
import type {
  MerchantOrderDetailResponseView,
  MerchantOrderFinancialAccess,
  MerchantOrderListResponseView,
} from '../domain/order.types';
import { OrderRepository } from '../infrastructure/order.repository';

@Injectable()
export class MerchantOrderService {
  private readonly logger = new Logger(MerchantOrderService.name);

  constructor(
    private readonly access: MerchantAccessService,
    private readonly orders: OrderRepository,
    private readonly notifications: NotificationService,
    private readonly paidTerminalRefunds: PaidTerminalRefundService,
    @Inject(MATCHING_JOBS) private readonly matchingJobs: MatchingJobs,
  ) {}

  async listOrders(
    accountId: string,
    merchantId: string,
    query: {
      limit?: number;
      offset?: number;
      branchId?: string;
      orderStatus?: string;
      fulfillmentStatus?: string;
    },
  ): Promise<MerchantOrderListResponseView> {
    const financialAccess = await this.requireOrderCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.ORDER_READ,
    );
    const page = normalizeOrderListQuery(query);
    const branchIds = await this.resolveBranchScope(merchantId, query.branchId);
    const listed = await this.orders.listMerchantOrders(branchIds, {
      limit: page.limit,
      offset: page.offset,
      orderStatus: query.orderStatus,
      fulfillmentStatus: query.fulfillmentStatus,
    });
    return {
      items: listed.items.map((item) =>
        projectMerchantOrderForRole(item, financialAccess),
      ),
      limit: page.limit,
      offset: page.offset,
      total: listed.total,
    };
  }

  async getOrder(
    accountId: string,
    merchantId: string,
    orderId: string,
  ): Promise<MerchantOrderDetailResponseView> {
    const financialAccess = await this.requireOrderCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.ORDER_READ,
    );
    const detail = await this.orders.findMerchantOrderDetail(
      orderId,
      merchantId,
    );
    if (!detail) {
      throw merchantOrderNotFound();
    }
    return projectMerchantOrderForRole(detail, financialAccess);
  }

  async acceptOrder(
    accountId: string,
    merchantId: string,
    orderId: string,
    preparationMinutes?: number,
  ): Promise<MerchantOrderDetailResponseView> {
    if (preparationMinutes !== undefined) {
      this.requirePreparationMinutes(preparationMinutes);
    }
    return this.transition(
      accountId,
      merchantId,
      orderId,
      'ACCEPT',
      undefined,
      preparationMinutes,
    );
  }

  async updatePreparationEstimate(
    accountId: string,
    merchantId: string,
    orderId: string,
    input: {
      addMinutes: number;
      expectedEstimateVersion: number;
      reason?: string;
    },
  ): Promise<MerchantOrderDetailResponseView> {
    const financialAccess = await this.requireOrderCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.ORDER_WORKFLOW_MUTATE,
    );
    if (
      !Number.isInteger(input.addMinutes) ||
      input.addMinutes < PREPARATION_ADD_MINUTES_MIN ||
      input.addMinutes > PREPARATION_ADD_MINUTES_MAX
    ) {
      throw merchantOrderPrepEstimateInvalid(
        `addMinutes must be an integer between ${PREPARATION_ADD_MINUTES_MIN} and ${PREPARATION_ADD_MINUTES_MAX}`,
      );
    }
    if (
      !Number.isInteger(input.expectedEstimateVersion) ||
      input.expectedEstimateVersion < 1
    ) {
      throw merchantOrderPrepEstimateInvalid(
        'expectedEstimateVersion must be an integer >= 1',
      );
    }
    let reason: string | null = null;
    if (input.reason != null && input.reason.trim() !== '') {
      reason = input.reason.trim();
      if (reason.length > PREPARATION_ESTIMATE_REASON_MAX) {
        throw merchantOrderPrepEstimateInvalid(
          `reason must be at most ${PREPARATION_ESTIMATE_REASON_MAX} characters`,
        );
      }
    }

    await this.orders.runInTransaction(async (tx) => {
      const merchant = await this.orders.findMerchantById(merchantId, tx);
      if (
        !merchant ||
        !isMerchantApproved(merchant.status, merchant.verifiedAt)
      ) {
        throw merchantStatusRestricted(
          'Merchant is not operational for Order workflow',
        );
      }
      const ownerMerchantId = await this.orders.findOrderMerchantId(
        orderId,
        tx,
      );
      if (ownerMerchantId !== merchantId) {
        throw merchantOrderNotFound();
      }
      const locked = await this.orders.lockOrder(orderId, tx);
      if (!locked) {
        throw merchantOrderNotFound();
      }
      const branchMerchantId = await this.orders.findBranchMerchantId(
        locked.merchantBranchId,
        tx,
      );
      if (branchMerchantId !== merchantId) {
        throw merchantOrderNotFound();
      }
      if (
        !isEligibleFulfillmentForPrepEstimateUpdate(
          locked.fulfillmentStatus,
          locked.status,
        )
      ) {
        throw merchantOrderPrepEstimateNotAllowed();
      }
      const result = await this.orders.applyPreparationEstimateAdd(
        orderId,
        accountId,
        locked.updatedAt,
        input.expectedEstimateVersion,
        input.addMinutes,
        reason,
        tx,
      );
      if (!result.ok) {
        if (result.reason === 'CONFLICT') {
          const current = await this.orders.findMerchantOrderDetail(
            orderId,
            merchantId,
            tx,
          );
          throw merchantOrderPrepEstimateConflict(
            current
              ? {
                  estimatedReadyAt: current.estimatedReadyAt,
                  originalEstimatedReadyAt: current.originalEstimatedReadyAt,
                  preparationMinutes: current.preparationMinutes,
                  originalPreparationMinutes:
                    current.originalPreparationMinutes,
                  preparationEstimateVersion:
                    current.preparationEstimateVersion,
                  isPreparationLate: current.isPreparationLate,
                }
              : undefined,
          );
        }
        if (result.reason === 'NO_ESTIMATE') {
          throw merchantOrderPrepEstimateNotAllowed(
            'Order has no preparation estimate to update',
          );
        }
        throw merchantOrderPrepEstimateNotAllowed();
      }
    });

    const detail = await this.orders.findMerchantOrderDetail(
      orderId,
      merchantId,
    );
    if (!detail) {
      throw merchantOrderNotFound();
    }
    return projectMerchantOrderForRole(detail, financialAccess);
  }

  async rejectOrder(
    accountId: string,
    merchantId: string,
    orderId: string,
    reason: string,
    reasonCode?: string | null,
  ): Promise<MerchantOrderDetailResponseView> {
    return this.transition(
      accountId,
      merchantId,
      orderId,
      'REJECT',
      reason,
      undefined,
      reasonCode,
    );
  }

  async startPreparation(
    accountId: string,
    merchantId: string,
    orderId: string,
  ): Promise<MerchantOrderDetailResponseView> {
    return this.transition(accountId, merchantId, orderId, 'START_PREPARATION');
  }

  async markReady(
    accountId: string,
    merchantId: string,
    orderId: string,
  ): Promise<MerchantOrderDetailResponseView> {
    return this.transition(accountId, merchantId, orderId, 'MARK_READY');
  }

  private async transition(
    accountId: string,
    merchantId: string,
    orderId: string,
    action: MerchantWorkflowAction,
    reason?: string,
    preparationMinutes?: number,
    reasonCode?: string | null,
  ): Promise<MerchantOrderDetailResponseView> {
    const financialAccess = await this.requireOrderCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.ORDER_WORKFLOW_MUTATE,
    );
    const rejectionReason =
      action === 'REJECT' ? this.requireRejectionReason(reason) : undefined;
    const rejectionReasonCode =
      action === 'REJECT' ? this.normalizeReasonCode(reasonCode) : null;
    let customerId = '';
    let publicReference = '';
    await this.orders.runInTransaction(async (tx) => {
      const merchant = await this.orders.findMerchantById(merchantId, tx);
      if (
        !merchant ||
        !isMerchantApproved(merchant.status, merchant.verifiedAt)
      ) {
        throw merchantStatusRestricted(
          'Merchant is not operational for Order workflow',
        );
      }
      const ownerMerchantId = await this.orders.findOrderMerchantId(
        orderId,
        tx,
      );
      if (ownerMerchantId !== merchantId) {
        throw merchantOrderNotFound();
      }
      const locked = await this.orders.lockOrder(orderId, tx);
      if (!locked) {
        throw merchantOrderNotFound();
      }
      customerId = locked.customerId;
      publicReference = locked.publicReference;
      const branchMerchantId = await this.orders.findBranchMerchantId(
        locked.merchantBranchId,
        tx,
      );
      if (branchMerchantId !== merchantId) {
        throw merchantOrderNotFound();
      }
      const decision = inspectMerchantWorkflowTransition(
        action,
        locked.status,
        locked.fulfillmentStatus,
      );
      if (decision === 'ALREADY_ACCEPTED') {
        throw merchantOrderAlreadyAccepted();
      }
      if (decision === 'NOT_REJECTABLE') {
        throw merchantOrderNotRejectable();
      }
      if (decision !== 'APPLY') {
        throw merchantOrderInvalidTransition();
      }
      const payment = await this.orders.findPaymentByOrderId(orderId, tx);
      if (action === 'START_PREPARATION') {
        if (
          !payment ||
          !merchantPreparationPaymentReady(payment.method, payment.status)
        ) {
          throw merchantOrderPaymentNotReady();
        }
      }
      if (action === 'REJECT') {
        if (
          !payment ||
          (payment.status !== PAYMENT_STATUS_PENDING &&
            payment.status !== PAYMENT_STATUS_PROCESSING &&
            payment.status !== PAYMENT_STATUS_SUCCEEDED &&
            payment.status !== PAYMENT_STATUS_FAILED &&
            payment.status !== 'CANCELLED')
        ) {
          throw merchantOrderNotRejectable();
        }
      }
      const applied =
        action === 'ACCEPT'
          ? await this.orders.applyMerchantAccept(
              orderId,
              accountId,
              locked.updatedAt,
              tx,
              preparationMinutes,
            )
          : action === 'REJECT'
            ? await this.orders.applyMerchantReject(
                orderId,
                accountId,
                rejectionReason ?? '',
                locked.updatedAt,
                tx,
                rejectionReasonCode,
              )
            : action === 'START_PREPARATION'
              ? await this.orders.applyStartPreparation(
                  orderId,
                  accountId,
                  locked.updatedAt,
                  tx,
                )
              : await this.orders.applyMarkReady(
                  orderId,
                  accountId,
                  locked.updatedAt,
                  tx,
                );
      if (applied !== true && applied !== 'APPLIED') {
        throw action === 'REJECT'
          ? merchantOrderNotRejectable()
          : merchantOrderInvalidTransition();
      }
      if (action === 'REJECT') {
        const paymentAfter = await this.orders.findPaymentByOrderId(
          orderId,
          tx,
        );
        if (paymentAfter?.status === PAYMENT_STATUS_SUCCEEDED) {
          await this.paidTerminalRefunds.ensureRefundIntentInTx(tx, {
            orderId,
            origin: REFUND_REQUEST_ORIGIN_MERCHANT_REJECTION,
            reason: PAID_TERMINAL_REASON_MERCHANT_REJECT,
          });
        }
      }
    });
    const detail = await this.orders.findMerchantOrderDetail(
      orderId,
      merchantId,
    );
    if (!detail) {
      throw merchantOrderNotFound();
    }
    if (action === 'MARK_READY') {
      try {
        await this.matchingJobs.enqueueStart(orderId);
      } catch (error) {
        this.logger.warn(
          `Matching start enqueue failed for order ${orderId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (action === 'ACCEPT') {
      await this.notifications.notifyOrderAccepted({
        orderId,
        customerId,
        publicReference,
      });
    } else if (action === 'REJECT') {
      await this.notifications.notifyOrderRejected({
        orderId,
        customerId,
        publicReference,
      });
    } else if (action === 'MARK_READY') {
      await this.notifications.notifyOrderReady({
        orderId,
        customerId,
        publicReference,
      });
    }
    return projectMerchantOrderForRole(detail, financialAccess);
  }

  private async requireOrderCapability(
    accountId: string,
    merchantId: string,
    capability:
      | typeof MERCHANT_CAPABILITIES.ORDER_READ
      | typeof MERCHANT_CAPABILITIES.ORDER_WORKFLOW_MUTATE,
  ): Promise<MerchantOrderFinancialAccess> {
    const context = await this.access.requireCapability(
      accountId,
      merchantId,
      capability,
    );
    return merchantFinanceAccess(parseMerchantMemberRole(context.member.role));
  }

  private requireRejectionReason(reason: string | undefined): string {
    const trimmed = reason?.trim() ?? '';
    if (
      trimmed.length < 1 ||
      trimmed.length > MERCHANT_REJECTION_REASON_MAX_LENGTH
    ) {
      throw merchantOrderNotRejectable();
    }
    return trimmed;
  }

  private normalizeReasonCode(
    reasonCode: string | null | undefined,
  ): MerchantCancellationReasonCode | null {
    if (reasonCode == null) {
      return null;
    }
    if (!isMerchantCancellationReasonCode(reasonCode)) {
      throw merchantOrderNotRejectable();
    }
    return reasonCode;
  }

  private requirePreparationMinutes(minutes: number): void {
    if (
      !Number.isInteger(minutes) ||
      minutes < PREPARATION_MINUTES_MIN ||
      minutes > PREPARATION_MINUTES_MAX
    ) {
      throw merchantOrderPrepEstimateInvalid(
        `preparationMinutes must be an integer between ${PREPARATION_MINUTES_MIN} and ${PREPARATION_MINUTES_MAX}`,
      );
    }
  }

  private async resolveBranchScope(
    merchantId: string,
    branchId?: string,
  ): Promise<string[]> {
    if (!branchId) {
      return this.orders.listBranchIdsForMerchant(merchantId);
    }
    const owner = await this.orders.findBranchMerchantId(branchId);
    if (owner !== merchantId) {
      throw merchantBranchNotFound();
    }
    return [branchId];
  }
}
