import { Injectable } from '@nestjs/common';
import { moneyMinorToDecimalString } from '../../../common/money/money-minor';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import {
  pgTimestamptz,
  pgVarchar,
} from '../../../infrastructure/database/pg-values';
import { OpeningHoursService } from '../../merchants/application/opening-hours.service';
import type {
  AvailabilityMode,
  AvailabilityReasonCode,
} from '../../merchants/domain/branch-availability.constants';
import { resolveEffectiveMode } from '../../merchants/domain/branch-availability.evaluator';
import { isVerificationReady } from '../../merchants/domain/merchant.policy';
import { parsePromotionType } from '../../promotions/domain/promotion.policy';
import { PROMOTION_KIND_FIXED_MINOR } from '../../promotions/domain/promotion.types';
import {
  loadPromotionDomainValue,
  promotionValueAmountDzd,
} from '../../promotions/infrastructure/promotion-money-storage';
import { adminNotFound } from '../domain/admin.errors';
import { normalizeListQuery } from '../domain/admin.policy';
import { DRIVER_VEHICLE_STATUS_ACTIVE } from '../../drivers/domain/driver.policy';
import type {
  AdminCodRemittanceListItem,
  AdminCustomerAddressItem,
  AdminCustomerComplaintItem,
  AdminCustomerDetail,
  AdminCustomerListItem,
  AdminDriverCurrentMission,
  AdminDriverDetail,
  AdminDriverListItem,
  AdminDriverMatchingOccupancy,
  AdminDriverVerificationPackage,
  AdminListQuery,
  AdminMerchantBranchStoreItem,
  AdminMerchantListItem,
  AdminMerchantQueueItem,
  AdminOrderDetail,
  AdminOrderFinancialSnapshot,
  AdminOrderItem,
  AdminOrderListItem,
  AdminOrderTimelineEvent,
  AdminPaginatedResult,
  AdminPaymentListItem,
  AdminPromotionListItem,
  AdminRefundListItem,
  AdminSettlementListItem,
} from '../domain/admin.types';

function parseCoordinate(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return Number(value);
  }
  return Number.NaN;
}

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

function mapPromotionRow(row: {
  id: string;
  code: string;
  type: string;
  value: number | null;
  valueAmount?: unknown;
  startsAt: string;
  endsAt: string;
  active: boolean;
  customerDiscoverable: boolean;
  customerLabel: string | null;
  createdAt: string;
  updatedAt: string;
}): AdminPromotionListItem {
  const domainValue = loadPromotionDomainValue({
    type: String(row.type),
    value: row.value,
    valueAmount: row.valueAmount,
  });
  const parsed = parsePromotionType(String(row.type));
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    value:
      parsed.kind === PROMOTION_KIND_FIXED_MINOR
        ? moneyMinorToDecimalString(domainValue)
        : domainValue,
    valueAmount: promotionValueAmountDzd(String(row.type), domainValue),
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    active: row.active,
    customerDiscoverable: Boolean(row.customerDiscoverable),
    customerLabel:
      row.customerLabel == null ? null : String(row.customerLabel),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class AdminQueryRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly openingHours: OpeningHoursService,
  ) {}

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
        documentsReceived: documents.length,
      });
    }

    return pageResult(items, total, query);
  }

  async listDrivers(input: {
    limit?: number;
    offset?: number;
    verificationStatus?: string;
    /** When true, attach document count + active vehicle summary (queue). */
    enrichVerificationQueue?: boolean;
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
    const enrich = Boolean(input.enrichVerificationQueue);
    const items: AdminDriverListItem[] = [];
    for (const row of rows) {
      const base: AdminDriverListItem = {
        id: row.id,
        fullName: row.fullName,
        verificationStatus: row.verificationStatus,
        approvedAt: row.approvedAt,
        createdAt: row.createdAt,
      };
      if (!enrich) {
        items.push(base);
        continue;
      }
      const documents = await orm(this.db())
        .DriverDocument.where({ driverId: row.id })
        .all();
      const vehicles = await orm(this.db())
        .Vehicle.where({
          driverId: row.id,
          status: pgVarchar<64>(DRIVER_VEHICLE_STATUS_ACTIVE),
        })
        .all();
      const vehicle = vehicles[0];
      items.push({
        ...base,
        documentsReceived: documents.length,
        vehicleType: vehicle?.type ?? null,
        vehiclePlate: vehicle?.plateNumber ?? null,
      });
    }
    return pageResult(items, Number(counted.total), query);
  }

  async getDriver(id: string): Promise<AdminDriverDetail> {
    const db = this.db();
    const row = await orm(db).DriverProfile.where({ id }).first();
    if (!row) {
      throw adminNotFound('Driver not found');
    }

    const availability = await orm(db)
      .DriverAvailability.where({ driverId: id })
      .first();
    const availabilityStatus = availability?.status ?? null;

    const openAssignment = await orm(db)
      .DriverAssignment.where({
        driverId: id,
        releasedAt: null,
      })
      .first();

    let currentMission: AdminDriverCurrentMission | null = null;
    if (openAssignment) {
      const delivery = await orm(db)
        .Delivery.where({ id: openAssignment.deliveryId })
        .first();
      if (delivery) {
        const order = await orm(db)
          .Order.where({ id: delivery.orderId })
          .first();
        if (order) {
          currentMission = {
            assignmentId: openAssignment.id,
            assignmentStatus: openAssignment.status,
            deliveryId: delivery.id,
            deliveryStatus: delivery.status,
            orderId: order.id,
            orderPublicReference: order.publicReference,
          };
        }
      }
    }

    const matchingOccupancy: AdminDriverMatchingOccupancy =
      availabilityStatus === 'ONLINE'
        ? currentMission
          ? 'ONLINE_ON_MISSION'
          : 'ONLINE_AVAILABLE'
        : availabilityStatus === 'OFFLINE'
          ? 'OFFLINE'
          : 'UNKNOWN';

    return {
      id: row.id,
      fullName: row.fullName,
      verificationStatus: row.verificationStatus,
      approvedAt: row.approvedAt,
      createdAt: row.createdAt,
      availabilityStatus,
      matchingOccupancy,
      currentMission,
    };
  }

  /**
   * Metadata-only verification package for Admin document inspection.
   * Never returns fileUrl / object keys / storage paths.
   */
  async getDriverVerification(
    id: string,
  ): Promise<AdminDriverVerificationPackage> {
    const row = await orm(this.db()).DriverProfile.where({ id }).first();
    if (!row) {
      throw adminNotFound('Driver not found');
    }
    const documents = await orm(this.db())
      .DriverDocument.where({ driverId: id })
      .all();
    const vehicles = await orm(this.db())
      .Vehicle.where({
        driverId: id,
        status: pgVarchar<64>(DRIVER_VEHICLE_STATUS_ACTIVE),
      })
      .all();
    const vehicle = vehicles[0];
    return {
      driverId: row.id,
      fullName: row.fullName,
      verificationStatus: row.verificationStatus,
      approvedAt: row.approvedAt,
      createdAt: row.createdAt,
      documents: documents.map((doc) => ({
        id: doc.id,
        type: doc.type,
        status: doc.status,
        expiryDate: doc.expiryDate,
      })),
      vehicle: vehicle
        ? {
            type: vehicle.type,
            plateNumber: vehicle.plateNumber,
            model: vehicle.model,
          }
        : null,
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
    const accountIds = rows.map((row) => row.accountId);
    const accounts =
      accountIds.length === 0
        ? []
        : await orm(this.db())
            .Account.where((account) => account.id.in(accountIds))
            .all();
    const accountById = new Map(
      accounts.map((account) => [account.id, account]),
    );
    return pageResult(
      rows.map((row) => {
        const account = accountById.get(row.accountId);
        return {
          id: row.id,
          fullName: row.fullName,
          avatarUrl: row.avatarUrl,
          phone: account?.phone ?? null,
          accountStatus: account?.status ?? 'UNKNOWN',
          createdAt: row.createdAt,
        };
      }),
      Number(counted.total),
      query,
    );
  }

  async getCustomer(id: string): Promise<AdminCustomerDetail> {
    const row = await orm(this.db()).CustomerProfile.where({ id }).first();
    if (!row) {
      throw adminNotFound('Customer not found');
    }
    const account = await orm(this.db())
      .Account.where({ id: row.accountId })
      .first();
    if (!account) {
      throw adminNotFound('Customer account not found');
    }
    const colocated = await this.loadCustomerColocated(row.accountId);
    return {
      id: row.id,
      fullName: row.fullName,
      avatarUrl: row.avatarUrl,
      phone: account.phone ?? null,
      createdAt: row.createdAt,
      accountId: row.accountId,
      accountStatus: account.status,
      colocated,
    };
  }

  async listCustomerComplaints(
    customerId: string,
    input: { limit?: number; offset?: number },
  ): Promise<AdminPaginatedResult<AdminCustomerComplaintItem>> {
    const customer = await this.getCustomer(customerId);
    const query = normalizeListQuery(input);
    const where = { createdByAccountId: customer.accountId };
    const counted = await orm(this.db())
      .SupportTicket.where(where)
      .aggregate((agg) => ({ total: agg.count() }));
    const rows = await orm(this.db())
      .SupportTicket.where(where)
      .orderBy((ticket) => ticket.updatedAt.desc())
      .offset(query.offset)
      .limit(query.limit)
      .all();
    return pageResult(
      rows.map((row) => ({
        id: row.id,
        publicReference: row.publicReference,
        subject: row.subject ?? null,
        topicCode: row.topicCode ?? null,
        status: row.status,
        priority: row.priority,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      Number(counted.total),
      query,
    );
  }

  private async loadCustomerColocated(accountId: string): Promise<{
    hasAdminProfile: boolean;
    hasDriverProfile: boolean;
    hasMerchantMembership: boolean;
  }> {
    const [admin, driver, member] = await Promise.all([
      orm(this.db()).AdminProfile.where({ accountId }).first(),
      orm(this.db()).DriverProfile.where({ accountId }).first(),
      orm(this.db()).MerchantMember.where({ accountId }).first(),
    ]);
    return {
      hasAdminProfile: Boolean(admin),
      hasDriverProfile: Boolean(driver),
      hasMerchantMembership: Boolean(member),
    };
  }

  async listCustomerAddresses(
    customerId: string,
  ): Promise<{ items: AdminCustomerAddressItem[] }> {
    await this.getCustomer(customerId);
    const rows = await orm(this.db())
      .Address.where({ customerId })
      .orderBy((address) => address.createdAt.asc())
      .all();
    return {
      items: rows.map((row) => ({
        id: row.id,
        customerId: row.customerId,
        label: row.label,
        addressText: row.addressText,
        latitude: parseCoordinate(row.latitude),
        longitude: parseCoordinate(row.longitude),
        isDefault: row.isDefault,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    };
  }

  async listOrders(input: {
    limit?: number;
    offset?: number;
    status?: string;
    customerId?: string;
    merchantId?: string;
    merchantBranchId?: string;
    createdFrom?: string;
    createdTo?: string;
  }): Promise<AdminPaginatedResult<AdminOrderListItem>> {
    const query = normalizeListQuery(input);
    const db = this.db();

    let branchIds: string[] | null = null;
    if (input.merchantBranchId) {
      branchIds = [input.merchantBranchId];
    } else if (input.merchantId) {
      const branches = await orm(db)
        .MerchantBranch.where({ merchantId: input.merchantId })
        .all();
      branchIds = branches.map((branch) => branch.id);
      if (branchIds.length === 0) {
        return pageResult([], 0, query);
      }
    }

    let collection = orm(db).Order.where({});
    if (input.status) {
      collection = collection.where({
        status: input.status as
          | 'CREATED'
          | 'CONFIRMED'
          | 'ACTIVE'
          | 'COMPLETED'
          | 'CANCELLED'
          | 'FAILED',
      });
    }
    if (input.customerId) {
      collection = collection.where({ customerId: input.customerId });
    }
    if (branchIds) {
      collection = collection.where((order) =>
        order.merchantBranchId.in(branchIds),
      );
    }
    if (input.createdFrom) {
      const from = pgTimestamptz(input.createdFrom);
      collection = collection.where((order) => order.createdAt.gte(from));
    }
    if (input.createdTo) {
      const to = pgTimestamptz(input.createdTo);
      collection = collection.where((order) => order.createdAt.lt(to));
    }

    const counted = await collection.aggregate((agg) => ({
      total: agg.count(),
    }));
    const rows = await collection
      .orderBy((row) => row.createdAt.desc())
      .offset(query.offset)
      .limit(query.limit)
      .all();

    const items = await this.enrichAdminOrderListItems(rows, db);
    return pageResult(items, Number(counted.total), query);
  }

  /**
   * Additive list enrichment — batched by page IDs only (no N+1 getOrder).
   * Financial fields stay null when OrderFinancialSnapshot is absent.
   */
  private async enrichAdminOrderListItems(
    rows: Array<{
      id: string;
      publicReference: string;
      customerId: string;
      merchantBranchId: string;
      status: string;
      fulfillmentStatus: string;
      createdAt: string;
      confirmedAt: string | null;
      completedAt: string | null;
    }>,
    db: SpeedyGoDb,
  ): Promise<AdminOrderListItem[]> {
    if (rows.length === 0) {
      return [];
    }
    const orderIds = rows.map((row) => row.id);
    const customerIds = [...new Set(rows.map((row) => row.customerId))];
    const branchIds = [...new Set(rows.map((row) => row.merchantBranchId))];

    const [customers, branches, financials] = await Promise.all([
      orm(db)
        .CustomerProfile.where((profile) => profile.id.in(customerIds))
        .all(),
      orm(db)
        .MerchantBranch.where((branch) => branch.id.in(branchIds))
        .all(),
      orm(db)
        .OrderFinancialSnapshot.where((snap) => snap.orderId.in(orderIds))
        .all(),
    ]);

    const customerById = new Map(
      customers.map((customer) => [customer.id, customer]),
    );
    const branchById = new Map(branches.map((branch) => [branch.id, branch]));
    const merchantIds = [
      ...new Set(branches.map((branch) => branch.merchantId)),
    ];
    const merchants =
      merchantIds.length === 0
        ? []
        : await orm(db)
            .Merchant.where((merchant) => merchant.id.in(merchantIds))
            .all();
    const merchantById = new Map(
      merchants.map((merchant) => [merchant.id, merchant]),
    );
    const financialByOrderId = new Map(
      financials.map((snap) => [snap.orderId, snap]),
    );

    return rows.map((row) => {
      const customer = customerById.get(row.customerId);
      const branch = branchById.get(row.merchantBranchId);
      const merchant = branch
        ? merchantById.get(branch.merchantId)
        : undefined;
      const financial = financialByOrderId.get(row.id);
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
        customerFullName: customer?.fullName ?? null,
        customerAvatarUrl: customer?.avatarUrl ?? null,
        merchantName: merchant?.name ?? null,
        merchantBranchName: branch?.name ?? null,
        customerPayableMinor: financial
          ? moneyMinorToDecimalString(financial.customerPayableMinor)
          : null,
        currency: financial?.currency ?? null,
      };
    });
  }

  async getOrder(id: string): Promise<AdminOrderDetail> {
    const db = this.db();
    const row = await orm(db).Order.where({ id }).first();
    if (!row) {
      throw adminNotFound('Order not found');
    }

    const [
      itemRows,
      financialRow,
      addressRow,
      paymentRow,
      customerRow,
      branchRow,
      deliveryRow,
    ] = await Promise.all([
      orm(db).OrderItem.where({ orderId: id }).all(),
      orm(db).OrderFinancialSnapshot.where({ orderId: id }).first(),
      orm(db).OrderDeliveryAddressSnapshot.where({ orderId: id }).first(),
      orm(db).Payment.where({ orderId: id }).first(),
      orm(db).CustomerProfile.where({ id: row.customerId }).first(),
      orm(db).MerchantBranch.where({ id: row.merchantBranchId }).first(),
      orm(db).Delivery.where({ orderId: id }).first(),
    ]);

    const itemIds = itemRows.map((item) => item.id);
    const optionRows =
      itemIds.length === 0
        ? []
        : await orm(db)
            .OrderItemOption.where((option) => option.orderItemId.in(itemIds))
            .all();
    const optionsByItem = new Map<string, AdminOrderItem['options']>();
    for (const option of optionRows) {
      const list = optionsByItem.get(option.orderItemId) ?? [];
      list.push({
        optionNameSnapshot: option.optionNameSnapshot,
        additionalPriceMinor: moneyMinorToDecimalString(
          option.additionalPriceMinor,
        ),
      });
      optionsByItem.set(option.orderItemId, list);
    }
    const items: AdminOrderItem[] = itemRows.map((item) => ({
      id: item.id,
      productId: item.productId,
      productNameSnapshot: item.productNameSnapshot,
      quantity: item.quantity,
      unitPriceMinor: moneyMinorToDecimalString(item.unitPriceMinor),
      lineTotalMinor: moneyMinorToDecimalString(item.lineTotalMinor),
      options: optionsByItem.get(item.id) ?? [],
    }));

    let financial: AdminOrderFinancialSnapshot | null = null;
    if (financialRow) {
      financial = {
        currency: financialRow.currency,
        grossMerchandiseSubtotalMinor: moneyMinorToDecimalString(
          financialRow.grossMerchandiseSubtotalMinor,
        ),
        merchantDiscountMinor: moneyMinorToDecimalString(
          financialRow.merchantDiscountMinor,
        ),
        platformDiscountMinor: moneyMinorToDecimalString(
          financialRow.platformDiscountMinor,
        ),
        totalDiscountMinor: moneyMinorToDecimalString(
          financialRow.totalDiscountMinor,
        ),
        commissionBaseMinor: moneyMinorToDecimalString(
          financialRow.commissionBaseMinor,
        ),
        merchantCommissionRateBps: financialRow.merchantCommissionRateBps,
        merchantCommissionAmountMinor: moneyMinorToDecimalString(
          financialRow.merchantCommissionAmountMinor,
        ),
        merchantNetAmountMinor: moneyMinorToDecimalString(
          financialRow.merchantNetAmountMinor,
        ),
        customerDeliveryFeeMinor: moneyMinorToDecimalString(
          financialRow.customerDeliveryFeeMinor,
        ),
        driverRemunerationMinor: moneyMinorToDecimalString(
          financialRow.driverRemunerationMinor,
        ),
        speedyGoDeliveryShareMinor: moneyMinorToDecimalString(
          financialRow.speedyGoDeliveryShareMinor,
        ),
        serviceFeeMinor: moneyMinorToDecimalString(financialRow.serviceFeeMinor),
        customerPayableMinor: moneyMinorToDecimalString(
          financialRow.customerPayableMinor,
        ),
        commissionRuleId: financialRow.commissionRuleId,
        pricingRuleId: financialRow.pricingRuleId,
        createdAt: financialRow.createdAt,
      };
    }

    let customerPhone: string | null = null;
    if (customerRow) {
      const account = await orm(db)
        .Account.where({ id: customerRow.accountId })
        .first();
      customerPhone = account?.phone ?? null;
    }

    let merchantParty: AdminOrderDetail['merchant'] = null;
    if (branchRow) {
      const merchant = await orm(db)
        .Merchant.where({ id: branchRow.merchantId })
        .first();
      if (merchant) {
        merchantParty = {
          merchantId: merchant.id,
          merchantName: merchant.name,
          publicReference: merchant.publicReference,
          branchId: branchRow.id,
          branchName: branchRow.name,
          phone: branchRow.phone,
          addressText: branchRow.addressText,
          wilayaCode: branchRow.wilayaCode ?? null,
        };
      }
    }

    let driverParty: AdminOrderDetail['driver'] = null;
    if (deliveryRow) {
      const assignment =
        (await orm(db)
          .DriverAssignment.where({
            deliveryId: deliveryRow.id,
            status: pgVarchar<64>('ACCEPTED'),
            releasedAt: null,
          })
          .first()) ??
        (await orm(db)
          .DriverAssignment.where({
            deliveryId: deliveryRow.id,
            releasedAt: null,
          })
          .first());
      if (assignment) {
        const driver = await orm(db)
          .DriverProfile.where({ id: assignment.driverId })
          .first();
        if (driver) {
          driverParty = {
            driverId: driver.id,
            fullName: driver.fullName,
            assignmentStatus: assignment.status,
            deliveryStatus: deliveryRow.status,
          };
        }
      }
    }

    const [statusEventRows, deliveryEventRows] = await Promise.all([
      orm(db)
        .OrderStatusEvent.where({ orderId: id })
        .orderBy((event) => event.occurredAt.asc())
        .all(),
      deliveryRow
        ? orm(db)
            .DeliveryEvent.where({ deliveryId: deliveryRow.id })
            .orderBy((event) => event.occurredAt.asc())
            .all()
        : Promise.resolve([]),
    ]);

    const driverIds = [
      ...new Set(
        deliveryEventRows
          .map((event) => event.driverId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const timelineDrivers =
      driverIds.length === 0
        ? []
        : await orm(db)
            .DriverProfile.where((driver) => driver.id.in(driverIds))
            .all();
    const driverNameById = new Map(
      timelineDrivers.map((driver) => [driver.id, driver.fullName]),
    );

    const timeline: AdminOrderTimelineEvent[] = [
      ...statusEventRows.map((event) => ({
        source: 'ORDER_STATUS' as const,
        eventType: String(event.eventType),
        actorType: event.actorType ? String(event.actorType) : null,
        fromStatus: event.fromStatus ? String(event.fromStatus) : null,
        toStatus: event.toStatus ? String(event.toStatus) : null,
        occurredAt: event.occurredAt,
        driverId: null as string | null,
        driverFullName: null as string | null,
      })),
      ...deliveryEventRows.map((event) => ({
        source: 'DELIVERY' as const,
        eventType: String(event.type),
        actorType: null as string | null,
        fromStatus: null as string | null,
        toStatus: null as string | null,
        occurredAt: event.occurredAt,
        driverId: event.driverId ?? null,
        driverFullName: event.driverId
          ? (driverNameById.get(event.driverId) ?? null)
          : null,
      })),
    ].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

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
      customerFullName: customerRow?.fullName ?? null,
      customerAvatarUrl: customerRow?.avatarUrl ?? null,
      merchantName: merchantParty?.merchantName ?? null,
      merchantBranchName: merchantParty?.branchName ?? null,
      customerPayableMinor: financial?.customerPayableMinor ?? null,
      currency: financial?.currency ?? null,
      items,
      financial,
      deliveryAddress: addressRow
        ? {
            addressText: addressRow.addressText,
            latitude: parseCoordinate(addressRow.latitude),
            longitude: parseCoordinate(addressRow.longitude),
            instructions: addressRow.instructions,
          }
        : null,
      payment: paymentRow
        ? {
            id: paymentRow.id,
            method: paymentRow.method,
            status: paymentRow.status,
            amountMinor: moneyMinorToDecimalString(paymentRow.amountMinor),
            currency: paymentRow.currency,
          }
        : null,
      customer: customerRow
        ? {
            id: customerRow.id,
            fullName: customerRow.fullName,
            avatarUrl: customerRow.avatarUrl,
            phone: customerPhone,
          }
        : null,
      merchant: merchantParty,
      driver: driverParty,
      delivery: deliveryRow
        ? { id: deliveryRow.id, status: deliveryRow.status }
        : null,
      timeline,
    };
  }

  async listMerchantBranchesStore(
    merchantId: string,
  ): Promise<{ items: AdminMerchantBranchStoreItem[] }> {
    await this.getMerchant(merchantId);
    const branches = await orm(this.db())
      .MerchantBranch.where({ merchantId })
      .orderBy((branch) => branch.createdAt.asc())
      .all();
    const now = new Date();
    const items: AdminMerchantBranchStoreItem[] = [];
    for (const branch of branches) {
      const projection = await this.openingHours.getCustomerProjection(
        branch.id,
        now,
      );
      const override = await orm(this.db())
        .MerchantBranchAvailabilityOverride.where({ branchId: branch.id })
        .first();
      const overrideSnapshot = override
        ? {
            mode: override.mode as AvailabilityMode,
            reasonCode: (override.reasonCode ??
              null) as AvailabilityReasonCode | null,
            customerMessage: override.customerMessage ?? null,
            closedUntil: override.closedUntil
              ? new Date(override.closedUntil)
              : null,
            version: override.version,
            updatedAt: override.updatedAt,
          }
        : null;
      const resolved = resolveEffectiveMode(overrideSnapshot, now);
      items.push({
        id: branch.id,
        merchantId: branch.merchantId,
        name: branch.name,
        phone: branch.phone,
        addressText: branch.addressText,
        wilayaCode: branch.wilayaCode ?? null,
        communeId: branch.communeId ?? null,
        operationalStatus: branch.operationalStatus,
        description: branch.description ?? null,
        nameAr: branch.nameAr ?? null,
        publicEmail: branch.publicEmail ?? null,
        availability: {
          hoursConfigured: projection.hoursConfigured,
          acceptingOrders: projection.isOpenNow,
          availabilityMode: override?.mode ?? 'FOLLOW_SCHEDULE',
          effectiveMode: resolved.effectiveMode,
          closedUntil: override?.closedUntil ?? null,
          reasonCode: override?.reasonCode ?? null,
          customerMessage: override?.customerMessage ?? null,
          timezone: projection.timezone,
          currentClosesAt: projection.currentClosesAt
            ? new Date(projection.currentClosesAt).toISOString()
            : null,
          nextOpenAt: projection.nextOpenAt
            ? new Date(projection.nextOpenAt).toISOString()
            : null,
        },
      });
    }
    return { items };
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
        amountMinor: moneyMinorToDecimalString(row.amountMinor),
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
      amountMinor: moneyMinorToDecimalString(row.amountMinor),
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
        amountMinor: moneyMinorToDecimalString(row.amountMinor),
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
      amountMinor: moneyMinorToDecimalString(row.amountMinor),
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
        grossSalesMinor: moneyMinorToDecimalString(row.grossSalesMinor),
        commissionMinor: moneyMinorToDecimalString(row.commissionMinor),
        refundAdjustmentsMinor: moneyMinorToDecimalString(
          row.refundAdjustmentsMinor,
        ),
        manualAdjustmentsMinor: moneyMinorToDecimalString(
          row.manualAdjustmentsMinor,
        ),
        netPayableMinor: moneyMinorToDecimalString(row.netPayableMinor),
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
      grossSalesMinor: moneyMinorToDecimalString(row.grossSalesMinor),
      commissionMinor: moneyMinorToDecimalString(row.commissionMinor),
      refundAdjustmentsMinor: moneyMinorToDecimalString(
        row.refundAdjustmentsMinor,
      ),
      manualAdjustmentsMinor: moneyMinorToDecimalString(
        row.manualAdjustmentsMinor,
      ),
      netPayableMinor: moneyMinorToDecimalString(row.netPayableMinor),
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
      rows.map((row) => mapPromotionRow(row)),
      Number(counted.total),
      query,
    );
  }

  async getPromotion(id: string): Promise<AdminPromotionListItem> {
    const row = await orm(this.db()).Promotion.where({ id }).first();
    if (!row) {
      throw adminNotFound('Promotion not found');
    }
    return mapPromotionRow(row);
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
        submittedAmountMinor: moneyMinorToDecimalString(
          row.submittedAmountMinor,
        ),
        confirmedAmountMinor: moneyMinorToDecimalString(
          row.confirmedAmountMinor,
        ),
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
      submittedAmountMinor: moneyMinorToDecimalString(row.submittedAmountMinor),
      confirmedAmountMinor: moneyMinorToDecimalString(row.confirmedAmountMinor),
      status: row.status,
      reference: row.reference,
      submittedAt: row.submittedAt,
      confirmedAt: row.confirmedAt,
      createdAt: row.createdAt,
    };
  }
}
