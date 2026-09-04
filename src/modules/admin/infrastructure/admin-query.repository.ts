import { Injectable } from '@nestjs/common';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import { pgVarchar } from '../../../infrastructure/database/pg-values';
import { isVerificationReady } from '../../merchants/domain/merchant.policy';
import { adminNotFound } from '../domain/admin.errors';
import { normalizeListQuery } from '../domain/admin.policy';
import type {
  AdminCodRemittanceListItem,
  AdminCustomerListItem,
  AdminDriverListItem,
  AdminListQuery,
  AdminMerchantListItem,
  AdminMerchantQueueItem,
  AdminOrderListItem,
  AdminPaginatedResult,
  AdminPaymentListItem,
  AdminPromotionListItem,
  AdminRefundListItem,
  AdminSettlementListItem,
} from '../domain/admin.types';

function orm(db: SpeedyGoDb) {
  return db.orm.public;
}

function pageResult<T>(
  items: T[],
  total: number,
  query: AdminListQuery,
): AdminPaginatedResult<T> {
  return {
    items,
    total,
    limit: query.limit,
    offset: query.offset,
  };
}

@Injectable()
export class AdminQueryRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async listMerchants(input: {
    limit?: number;
    offset?: number;
    status?: string;
  }): Promise<AdminPaginatedResult<AdminMerchantListItem>> {
    const query = normalizeListQuery(input);
    const where = input.status ? { status: pgVarchar<64>(input.status) } : {};
    const counted = await orm(this.db())
      .Merchant.where(where)
      .aggregate((agg) => ({ total: agg.count() }));
    const rows = await orm(this.db())
      .Merchant.where(where)
      .orderBy((row) => row.createdAt.desc())
      .offset(query.offset)
      .limit(query.limit)
      .all();
    return pageResult(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        verifiedAt: row.verifiedAt,
        publicReference: row.publicReference,
        createdAt: row.createdAt,
      })),
      Number(counted.total),
      query,
    );
  }

  async getMerchant(id: string): Promise<AdminMerchantListItem> {
    const row = await orm(this.db()).Merchant.where({ id }).first();
    if (!row) {
      throw adminNotFound('Merchant not found');
    }
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      verifiedAt: row.verifiedAt,
      publicReference: row.publicReference,
      createdAt: row.createdAt,
    };
  }

  /**
   * Formally submitted PENDING_REVIEW packages only.
   * SQL discovers ALL merchants with BUSINESS_IDENTITY + BUSINESS_REGISTRATION
   * both SUBMITTED; paginates in DB. verificationReady is derived for the page.
   */
  async listMerchantVerificationQueue(input: {
    limit?: number;
    offset?: number;
  }): Promise<AdminPaginatedResult<AdminMerchantQueueItem>> {
    const query = normalizeListQuery(input);
    const db = this.db();

    const countPlan = db.raw.sql`
        SELECT COUNT(*)::int8 AS total
        FROM merchants m
        WHERE m.status = 'PENDING_REVIEW'
        AND EXISTS (
          SELECT 1 FROM merchant_documents d
          WHERE d.merchant_id = m.id
            AND d.type = 'BUSINESS_IDENTITY'
            AND d.status = 'SUBMITTED'
        )
        AND EXISTS (
          SELECT 1 FROM merchant_documents d
          WHERE d.merchant_id = m.id
            AND d.type = 'BUSINESS_REGISTRATION'
            AND d.status = 'SUBMITTED'
        )
      `
      .returnsRow({
        total: 'pg/int8@1',
      })
      .build();

    let total = 0;
    for await (const row of db.runtime().query(countPlan)) {
      total = Number(row.total);
    }

    const pagePlan = db.raw.sql`
        SELECT m.id, m.name, m.status, m.verified_at, m.public_reference, m.created_at
        FROM merchants m
        WHERE m.status = 'PENDING_REVIEW'
        AND EXISTS (
          SELECT 1 FROM merchant_documents d
          WHERE d.merchant_id = m.id
            AND d.type = 'BUSINESS_IDENTITY'
            AND d.status = 'SUBMITTED'
        )
        AND EXISTS (
          SELECT 1 FROM merchant_documents d
          WHERE d.merchant_id = m.id
            AND d.type = 'BUSINESS_REGISTRATION'
            AND d.status = 'SUBMITTED'
        )
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT ${query.limit} OFFSET ${query.offset}
      `
      .returnsRow({
        id: 'pg/uuid@1',
        name: 'sql/varchar@1',
        status: 'sql/varchar@1',
        verified_at: {
          codecId: 'pg/timestamptz-string@1',
          nullable: true,
        },
        public_reference: 'sql/varchar@1',
        created_at: 'pg/timestamptz-string@1',
      })
      .build();

    const pageRows: Array<{
      id: string;
      name: string;
      status: string;
      verified_at: string | null;
      public_reference: string;
      created_at: string;
    }> = [];
    for await (const row of db.runtime().query(pagePlan)) {
      pageRows.push(row);
    }

    const items: AdminMerchantQueueItem[] = [];
    for (const merchant of pageRows) {
      const documents = await orm(db)
        .MerchantDocument.where({ merchantId: merchant.id })
        .all();
      const summaries = documents.map((doc) => ({
        type: doc.type,
        status: doc.status,
        expiryDate: doc.expiryDate,
      }));
      items.push({
        id: merchant.id,
        name: merchant.name,
        status: merchant.status,
        verifiedAt: merchant.verified_at,
        publicReference: merchant.public_reference,
        createdAt: merchant.created_at,
        verificationReady: isVerificationReady({
          name: merchant.name,
          documents: summaries,
        }),
        // SQL WHERE already requires formal submission of both required docs.
        verificationSubmitted: true,
      });
    }

    return pageResult(items, total, query);
  }

  async listDrivers(input: {
    limit?: number;
    offset?: number;
    verificationStatus?: string;
  }): Promise<AdminPaginatedResult<AdminDriverListItem>> {
    const query = normalizeListQuery(input);
    const where = input.verificationStatus
      ? {
          verificationStatus: pgVarchar<64>(input.verificationStatus),
        }
      : {};
    const counted = await orm(this.db())
      .DriverProfile.where(where)
      .aggregate((agg) => ({ total: agg.count() }));
    const rows = await orm(this.db())
      .DriverProfile.where(where)
      .orderBy((row) => row.createdAt.desc())
      .offset(query.offset)
      .limit(query.limit)
      .all();
    return pageResult(
      rows.map((row) => ({
        id: row.id,
        fullName: row.fullName,
        verificationStatus: row.verificationStatus,
        approvedAt: row.approvedAt,
        createdAt: row.createdAt,
      })),
      Number(counted.total),
      query,
    );
  }

  async getDriver(id: string): Promise<AdminDriverListItem> {
    const row = await orm(this.db()).DriverProfile.where({ id }).first();
    if (!row) {
      throw adminNotFound('Driver not found');
    }
    return {
      id: row.id,
      fullName: row.fullName,
      verificationStatus: row.verificationStatus,
      approvedAt: row.approvedAt,
      createdAt: row.createdAt,
    };
  }

  async listCustomers(input: {
    limit?: number;
    offset?: number;
  }): Promise<AdminPaginatedResult<AdminCustomerListItem>> {
    const query = normalizeListQuery(input);
    const counted = await orm(this.db())
      .CustomerProfile.where({})
      .aggregate((agg) => ({ total: agg.count() }));
    const rows = await orm(this.db())
      .CustomerProfile.where({})
      .orderBy((row) => row.createdAt.desc())
      .offset(query.offset)
      .limit(query.limit)
      .all();
    return pageResult(
      rows.map((row) => ({
        id: row.id,
        fullName: row.fullName,
        avatarUrl: row.avatarUrl,
        createdAt: row.createdAt,
      })),
      Number(counted.total),
      query,
    );
  }

  async getCustomer(id: string): Promise<AdminCustomerListItem> {
    const row = await orm(this.db()).CustomerProfile.where({ id }).first();
    if (!row) {
      throw adminNotFound('Customer not found');
    }
    return {
      id: row.id,
      fullName: row.fullName,
      avatarUrl: row.avatarUrl,
      createdAt: row.createdAt,
    };
  }

  async listOrders(input: {
    limit?: number;
    offset?: number;
    status?: string;
  }): Promise<AdminPaginatedResult<AdminOrderListItem>> {
    const query = normalizeListQuery(input);
    const where = input.status
      ? {
          status: input.status as
            | 'CREATED'
            | 'CONFIRMED'
            | 'ACTIVE'
            | 'COMPLETED'
            | 'CANCELLED'
            | 'FAILED',
        }
      : {};
    const counted = await orm(this.db())
      .Order.where(where)
      .aggregate((agg) => ({ total: agg.count() }));
    const rows = await orm(this.db())
      .Order.where(where)
      .orderBy((row) => row.createdAt.desc())
      .offset(query.offset)
      .limit(query.limit)
      .all();
    return pageResult(
      rows.map((row) => ({
        id: row.id,
        publicReference: row.publicReference,
        customerId: row.customerId,
        merchantBranchId: row.merchantBranchId,
        status: row.status,
        fulfillmentStatus: row.fulfillmentStatus,
        createdAt: row.createdAt,
        confirmedAt: row.confirmedAt,
        completedAt: row.completedAt,
      })),
      Number(counted.total),
      query,
    );
  }

  async getOrder(id: string): Promise<AdminOrderListItem> {
    const row = await orm(this.db()).Order.where({ id }).first();
    if (!row) {
      throw adminNotFound('Order not found');
    }
    return {
      id: row.id,
      publicReference: row.publicReference,
      customerId: row.customerId,
      merchantBranchId: row.merchantBranchId,
      status: row.status,
      fulfillmentStatus: row.fulfillmentStatus,
      createdAt: row.createdAt,
      confirmedAt: row.confirmedAt,
      completedAt: row.completedAt,
    };
  }

  async listPayments(input: {
    limit?: number;
    offset?: number;
    status?: string;
  }): Promise<AdminPaginatedResult<AdminPaymentListItem>> {
    const query = normalizeListQuery(input);
    const where = input.status
      ? {
          status: input.status as
            'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED',
        }
      : {};
    const counted = await orm(this.db())
      .Payment.where(where)
      .aggregate((agg) => ({ total: agg.count() }));
    const rows = await orm(this.db())
      .Payment.where(where)
      .orderBy((row) => row.createdAt.desc())
      .offset(query.offset)
      .limit(query.limit)
      .all();
    return pageResult(
      rows.map((row) => ({
        id: row.id,
        orderId: row.orderId,
        method: row.method,
        status: row.status,
        amountMinor: Number(row.amountMinor),
        currency: row.currency,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      Number(counted.total),
      query,
    );
  }

  async getPayment(id: string): Promise<AdminPaymentListItem> {
    const row = await orm(this.db()).Payment.where({ id }).first();
    if (!row) {
      throw adminNotFound('Payment not found');
    }
    return {
      id: row.id,
      orderId: row.orderId,
      method: row.method,
      status: row.status,
      amountMinor: Number(row.amountMinor),
      currency: row.currency,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async listRefunds(input: {
    limit?: number;
    offset?: number;
    status?: string;
    orderId?: string;
  }): Promise<AdminPaginatedResult<AdminRefundListItem>> {
    const query = normalizeListQuery(input);
    const where: Record<string, unknown> = {};
    if (input.status) {
      where.status = pgVarchar<64>(input.status);
    }
    if (input.orderId) {
      where.orderId = input.orderId;
    }
    const counted = await orm(this.db())
      .Refund.where(where)
      .aggregate((agg) => ({ total: agg.count() }));
    const rows = await orm(this.db())
      .Refund.where(where)
      .orderBy((row) => row.createdAt.desc())
      .offset(query.offset)
      .limit(query.limit)
      .all();
    return pageResult(
      rows.map((row) => ({
        id: row.id,
        orderId: row.orderId,
        paymentTransactionId: row.paymentTransactionId,
        refundMethod: row.refundMethod,
        amountMinor: Number(row.amountMinor),
        status: row.status,
        reason: row.reason,
        internalNote: row.internalNote,
        requestedByAdminId: row.requestedByAdminId,
        requestedAt: row.requestedAt,
        completedAt: row.completedAt,
        createdAt: row.createdAt,
      })),
      Number(counted.total),
      query,
    );
  }

  async getRefund(id: string): Promise<AdminRefundListItem> {
    const row = await orm(this.db()).Refund.where({ id }).first();
    if (!row) {
      throw adminNotFound('Refund not found');
    }
    return {
      id: row.id,
      orderId: row.orderId,
      paymentTransactionId: row.paymentTransactionId,
      refundMethod: row.refundMethod,
      amountMinor: Number(row.amountMinor),
      status: row.status,
      reason: row.reason,
      internalNote: row.internalNote,
      requestedByAdminId: row.requestedByAdminId,
      requestedAt: row.requestedAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
    };
  }

  async listSettlements(input: {
    limit?: number;
    offset?: number;
    merchantId?: string;
    status?: string;
  }): Promise<AdminPaginatedResult<AdminSettlementListItem>> {
    const query = normalizeListQuery(input);
    const where: Record<string, unknown> = {};
    if (input.merchantId) {
      where.merchantId = input.merchantId;
    }
    if (input.status) {
      where.status = pgVarchar<64>(input.status);
    }
    const counted = await orm(this.db())
      .MerchantSettlement.where(where)
      .aggregate((agg) => ({ total: agg.count() }));
    const rows = await orm(this.db())
      .MerchantSettlement.where(where)
      .orderBy((row) => row.createdAt.desc())
      .offset(query.offset)
      .limit(query.limit)
      .all();
    return pageResult(
      rows.map((row) => ({
        id: row.id,
        merchantId: row.merchantId,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        status: row.status,
        grossSalesMinor: Number(row.grossSalesMinor),
        commissionMinor: Number(row.commissionMinor),
        refundAdjustmentsMinor: Number(row.refundAdjustmentsMinor),
        manualAdjustmentsMinor: Number(row.manualAdjustmentsMinor),
        netPayableMinor: Number(row.netPayableMinor),
        paidAt: row.paidAt,
        createdAt: row.createdAt,
      })),
      Number(counted.total),
      query,
    );
  }

  async getSettlement(id: string): Promise<AdminSettlementListItem> {
    const row = await orm(this.db()).MerchantSettlement.where({ id }).first();
    if (!row) {
      throw adminNotFound('Settlement not found');
    }
    return {
      id: row.id,
      merchantId: row.merchantId,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      status: row.status,
      grossSalesMinor: Number(row.grossSalesMinor),
      commissionMinor: Number(row.commissionMinor),
      refundAdjustmentsMinor: Number(row.refundAdjustmentsMinor),
      manualAdjustmentsMinor: Number(row.manualAdjustmentsMinor),
      netPayableMinor: Number(row.netPayableMinor),
      paidAt: row.paidAt,
      createdAt: row.createdAt,
    };
  }

  async listPromotions(input: {
    limit?: number;
    offset?: number;
    active?: boolean;
  }): Promise<AdminPaginatedResult<AdminPromotionListItem>> {
    const query = normalizeListQuery(input);
    const where = input.active === undefined ? {} : { active: input.active };
    const counted = await orm(this.db())
      .Promotion.where(where)
      .aggregate((agg) => ({ total: agg.count() }));
    const rows = await orm(this.db())
      .Promotion.where(where)
      .orderBy((row) => row.createdAt.desc())
      .offset(query.offset)
      .limit(query.limit)
      .all();
    return pageResult(
      rows.map((row) => ({
        id: row.id,
        code: row.code,
        type: row.type,
        value: row.value,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        active: row.active,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      Number(counted.total),
      query,
    );
  }

  async getPromotion(id: string): Promise<AdminPromotionListItem> {
    const row = await orm(this.db()).Promotion.where({ id }).first();
    if (!row) {
      throw adminNotFound('Promotion not found');
    }
    return {
      id: row.id,
      code: row.code,
      type: row.type,
      value: row.value,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      active: row.active,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async listCodRemittances(input: {
    limit?: number;
    offset?: number;
    driverId?: string;
    status?: string;
  }): Promise<AdminPaginatedResult<AdminCodRemittanceListItem>> {
    const query = normalizeListQuery(input);
    const where: Record<string, unknown> = {};
    if (input.driverId) {
      where.driverId = input.driverId;
    }
    if (input.status) {
      where.status = pgVarchar<64>(input.status);
    }
    const counted = await orm(this.db())
      .CodRemittance.where(where)
      .aggregate((agg) => ({ total: agg.count() }));
    const rows = await orm(this.db())
      .CodRemittance.where(where)
      .orderBy((row) => row.createdAt.desc())
      .offset(query.offset)
      .limit(query.limit)
      .all();
    return pageResult(
      rows.map((row) => ({
        id: row.id,
        driverId: row.driverId,
        submittedAmountMinor: Number(row.submittedAmountMinor),
        confirmedAmountMinor: Number(row.confirmedAmountMinor),
        status: row.status,
        reference: row.reference,
        submittedAt: row.submittedAt,
        confirmedAt: row.confirmedAt,
        createdAt: row.createdAt,
      })),
      Number(counted.total),
      query,
    );
  }

  async getCodRemittance(id: string): Promise<AdminCodRemittanceListItem> {
    const row = await orm(this.db()).CodRemittance.where({ id }).first();
    if (!row) {
      throw adminNotFound('COD remittance not found');
    }
    return {
      id: row.id,
      driverId: row.driverId,
      submittedAmountMinor: Number(row.submittedAmountMinor),
      confirmedAmountMinor: Number(row.confirmedAmountMinor),
      status: row.status,
      reference: row.reference,
      submittedAt: row.submittedAt,
      confirmedAt: row.confirmedAt,
      createdAt: row.createdAt,
    };
  }
}
