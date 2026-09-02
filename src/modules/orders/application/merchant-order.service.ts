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
} from '../../merchants/domain/merchant.policy';
import {
  merchantOrderAlreadyAccepted,
  merchantOrderInvalidTransition,
  merchantOrderNotFound,
  merchantOrderNotRejectable,
  merchantOrderPaymentNotReady,
  merchantOrderRejectionRequiresCancellationFlow,
} from '../domain/order.errors';
import {
  inspectMerchantWorkflowTransition,
  merchantPreparationPaymentReady,
  MERCHANT_REJECTION_REASON_MAX_LENGTH,
  normalizeOrderListQuery,
  PAYMENT_STATUS_PENDING,
  type MerchantWorkflowAction,
} from '../domain/order.policy';
import type {
  MerchantOrderDetailView,
  MerchantOrderListView,
} from '../domain/order.types';
import { OrderRepository } from '../infrastructure/order.repository';

@Injectable()
export class MerchantOrderService {
  private readonly logger = new Logger(MerchantOrderService.name);

  constructor(
    private readonly access: MerchantAccessService,
    private readonly orders: OrderRepository,
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
  ): Promise<MerchantOrderListView> {
    await this.access.requireCapability(
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
      items: listed.items,
      limit: page.limit,
      offset: page.offset,
      total: listed.total,
    };
  }

  async getOrder(
    accountId: string,
    merchantId: string,
    orderId: string,
  ): Promise<MerchantOrderDetailView> {
    await this.access.requireCapability(
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
    return detail;
  }

  async acceptOrder(
    accountId: string,
    merchantId: string,
    orderId: string,
  ): Promise<MerchantOrderDetailView> {
    return this.transition(accountId, merchantId, orderId, 'ACCEPT');
  }

  async rejectOrder(
    accountId: string,
    merchantId: string,
    orderId: string,
    reason: string,
  ): Promise<MerchantOrderDetailView> {
    return this.transition(accountId, merchantId, orderId, 'REJECT', reason);
  }

  async startPreparation(
    accountId: string,
    merchantId: string,
    orderId: string,
  ): Promise<MerchantOrderDetailView> {
    return this.transition(accountId, merchantId, orderId, 'START_PREPARATION');
  }

  async markReady(
    accountId: string,
    merchantId: string,
    orderId: string,
  ): Promise<MerchantOrderDetailView> {
    return this.transition(accountId, merchantId, orderId, 'MARK_READY');
  }

  private async transition(
    accountId: string,
    merchantId: string,
    orderId: string,
    action: MerchantWorkflowAction,
    reason?: string,
  ): Promise<MerchantOrderDetailView> {
    await this.access.requireCapability(
      accountId,
      merchantId,
      MERCHANT_CAPABILITIES.ORDER_WORKFLOW_MUTATE,
    );
    const rejectionReason =
      action === 'REJECT' ? this.requireRejectionReason(reason) : undefined;
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
        if (!payment || payment.status !== PAYMENT_STATUS_PENDING) {
          throw merchantOrderRejectionRequiresCancellationFlow();
        }
      }
      const applied =
        action === 'ACCEPT'
          ? await this.orders.applyMerchantAccept(
              orderId,
              accountId,
              locked.updatedAt,
              tx,
            )
          : action === 'REJECT'
            ? await this.orders.applyMerchantReject(
                orderId,
                accountId,
                rejectionReason ?? '',
                locked.updatedAt,
                tx,
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
      if (applied === 'PAYMENT_NOT_PENDING') {
        throw merchantOrderRejectionRequiresCancellationFlow();
      }
      if (applied !== true && applied !== 'APPLIED') {
        throw action === 'REJECT'
          ? merchantOrderNotRejectable()
          : merchantOrderInvalidTransition();
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
    return detail;
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
