import { Injectable } from '@nestjs/common';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import {
  pgBigInt,
  pgChar,
  pgNow,
  pgNumeric,
  pgTimestamptz,
  pgVarchar,
} from '../../../infrastructure/database/pg-values';
import { parseMinorUnits } from '../../catalog/domain/catalog.policy';
import { CART_STATUS_CONVERTED } from '../../cart/domain/cart.policy';
import type { CheckoutPricingRuleRecord } from '../../checkout/domain/checkout.types';
import { orderAlreadyCreated } from '../domain/order.errors';
import {
  MERCHANT_FULFILLMENT_STATUS_FILTERS,
  MERCHANT_ORDER_STATUS_FILTERS,
  ORDER_FULFILLMENT_ACCEPTED,
  ORDER_FULFILLMENT_PENDING_ACCEPTANCE,
  ORDER_FULFILLMENT_PREPARING,
  ORDER_FULFILLMENT_READY,
  ORDER_STATUS_ACTIVE,
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_CONFIRMED,
  ORDER_STATUS_CREATED,
  ORDER_STATUS_EVENT_ACTOR_CUSTOMER,
  ORDER_STATUS_EVENT_ACTOR_MERCHANT,
  ORDER_STATUS_EVENT_CREATED,
  ORDER_STATUS_EVENT_MERCHANT_ACCEPTED,
  ORDER_STATUS_EVENT_MERCHANT_REJECTED,
  ORDER_STATUS_EVENT_ORDER_READY,
  ORDER_STATUS_EVENT_PREPARATION_STARTED,
  PAYMENT_STATUS_CANCELLED,
  PAYMENT_STATUS_PENDING,
  uniqueSortedIds,
} from '../domain/order.policy';
import type {
  MerchantOrderDetailView,
  MerchantOrderListQuery,
  MerchantOrderStatusEventView,
  MerchantOrderSummaryView,
  OrderAddressRecord,
  OrderDetailView,
  OrderItemView,
  OrderListQuery,
  OrderSummaryView,
  OrderZoneRecord,
  PersistCreatedOrderInput,
} from '../domain/order.types';

export type OrmClient = { orm: SpeedyGoDb['orm'] };

function orm(client: OrmClient) {
  return client.orm.public;
}

function parseCoordinate(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return Number(value);
  }
  return Number.NaN;
}

@Injectable()
export class OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  runInTransaction<T>(fn: (tx: OrmClient) => Promise<T>): Promise<T> {
    return this.db().transaction((tx) => fn(tx));
  }

  async lockAddress(
    addressId: string,
    customerId: string,
    client: OrmClient,
  ): Promise<OrderAddressRecord | null> {
    await orm(client)
      .Address.where({ id: addressId, customerId })
      .update({ updatedAt: pgNow() });
    const row = await orm(client)
      .Address.where({ id: addressId, customerId })
      .first();
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      customerId: row.customerId,
      addressText: row.addressText,
      latitude: parseCoordinate(row.latitude),
      longitude: parseCoordinate(row.longitude),
    };
  }

  async lockProductOption(
    optionId: string,
    client: OrmClient,
  ): Promise<boolean> {
    await orm(client)
      .ProductOption.where({ id: optionId })
      .update({ updatedAt: pgNow() });
    const row = await orm(client).ProductOption.where({ id: optionId }).first();
    return Boolean(row);
  }

  /**
   * Active DeliveryZones whose MultiPolygon ST_Covers the Address point.
   * Same coverage contract as Checkout Foundation (boundary is inside).
   */
  async findCoveringZones(
    latitude: number,
    longitude: number,
  ): Promise<OrderZoneRecord[]> {
    const sqlClient = this.db();
    const plan = sqlClient.raw.sql`
      SELECT id, name
      FROM delivery_zones
      WHERE active = true
        AND ST_Covers(
          geometry,
          ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)
        )
    `
      .returnsRow({
        id: 'pg/uuid@1',
        name: 'sql/varchar@1',
      })
      .build();
    const rows = await sqlClient.runtime().query(plan);
    return rows.map((row) => ({ id: row.id, name: String(row.name) }));
  }

  async listActivePricingRules(
    zoneId: string,
    client: OrmClient,
  ): Promise<CheckoutPricingRuleRecord[]> {
    const rows = await orm(client)
      .DeliveryPricingRule.where({ zoneId, active: true })
      .all();
    return rows.map((row) => ({
      id: row.id,
      zoneId: row.zoneId,
      name: row.name,
      timeBand: row.timeBand,
      startLocalTime: row.startLocalTime,
      endLocalTime: row.endLocalTime,
      customerDeliveryFeeMinor: parseMinorUnits(row.customerDeliveryFeeMinor),
      driverRemunerationMinor: parseMinorUnits(row.driverRemunerationMinor),
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      active: row.active,
    }));
  }

  async persistCreatedOrder(
    input: PersistCreatedOrderInput,
    client: OrmClient,
  ): Promise<void> {
    const now = pgNow();
    const currency = pgChar<3>(input.financial.currency);
    await orm(client).Order.create({
      id: input.orderId,
      publicReference: pgVarchar<64>(input.publicReference),
      customerId: input.customerId,
      merchantBranchId: input.merchantBranchId,
      deliveryZoneId: input.deliveryZoneId,
      status: ORDER_STATUS_CREATED,
      fulfillmentStatus: ORDER_FULFILLMENT_PENDING_ACCEPTANCE,
      createdAt: now,
      confirmedAt: null,
      completedAt: null,
      updatedAt: now,
    });
    await orm(client).OrderDeliveryAddressSnapshot.create({
      orderId: input.orderId,
      addressText: input.address.addressText,
      latitude: pgNumeric<9, 6>(input.address.latitude, 6),
      longitude: pgNumeric<9, 6>(input.address.longitude, 6),
      instructions: null,
    });
    for (const line of input.lines) {
      const orderItemId = createUuidV7();
      await orm(client).OrderItem.create({
        id: orderItemId,
        orderId: input.orderId,
        productId: line.productId,
        productNameSnapshot: pgVarchar<255>(line.productNameSnapshot),
        quantity: line.quantity,
        unitPriceMinor: pgBigInt(line.unitPriceMinor),
        lineTotalMinor: pgBigInt(line.lineTotalMinor),
      });
      for (const option of line.options) {
        await orm(client).OrderItemOption.create({
          id: createUuidV7(),
          orderItemId,
          optionNameSnapshot: pgVarchar<255>(option.optionNameSnapshot),
          additionalPriceMinor: pgBigInt(option.additionalPriceMinor),
        });
      }
    }
    await orm(client).OrderFinancialSnapshot.create({
      orderId: input.orderId,
      currency,
      grossMerchandiseSubtotalMinor: pgBigInt(
        input.financial.grossMerchandiseSubtotalMinor,
      ),
      merchantDiscountMinor: pgBigInt(input.financial.merchantDiscountMinor),
      platformDiscountMinor: pgBigInt(input.financial.platformDiscountMinor),
      totalDiscountMinor: pgBigInt(input.financial.totalDiscountMinor),
      commissionBaseMinor: pgBigInt(input.financial.commissionBaseMinor),
      merchantCommissionRateBps: input.financial.merchantCommissionRateBps,
      merchantCommissionAmountMinor: pgBigInt(
        input.financial.merchantCommissionAmountMinor,
      ),
      merchantNetAmountMinor: pgBigInt(input.financial.merchantNetAmountMinor),
      customerDeliveryFeeMinor: pgBigInt(
        input.financial.customerDeliveryFeeMinor,
      ),
      driverRemunerationMinor: pgBigInt(
        input.financial.driverRemunerationMinor,
      ),
      speedyGoDeliveryShareMinor: pgBigInt(
        input.financial.speedyGoDeliveryShareMinor,
      ),
      serviceFeeMinor: pgBigInt(input.financial.serviceFeeMinor),
      customerPayableMinor: pgBigInt(input.financial.customerPayableMinor),
      commissionRuleId: input.financial.commissionRuleId,
      pricingRuleId: input.financial.pricingRuleId,
      createdAt: now,
    });
    await orm(client).OrderStatusEvent.create({
      id: createUuidV7(),
      orderId: input.orderId,
      eventType: pgVarchar<64>(ORDER_STATUS_EVENT_CREATED),
      actorType: pgVarchar<32>(ORDER_STATUS_EVENT_ACTOR_CUSTOMER),
      actorId: input.accountId,
      fromStatus: null,
      toStatus: pgVarchar<32>(ORDER_STATUS_CREATED),
      occurredAt: now,
      metadataJson: null,
    });
    await orm(client).Payment.create({
      id: createUuidV7(),
      orderId: input.orderId,
      method: pgVarchar<64>(input.paymentMethod),
      status: PAYMENT_STATUS_PENDING,
      amountMinor: pgBigInt(input.financial.customerPayableMinor),
      currency,
      createdAt: now,
      updatedAt: now,
    });
    await this.markCartConverted(input.cartId, client);
  }

  async markCartConverted(cartId: string, client: OrmClient): Promise<void> {
    const now = pgNow();
    await orm(client)
      .Cart.where({ id: cartId, status: 'ACTIVE' })
      .update({ status: CART_STATUS_CONVERTED, updatedAt: now });
    const row = await orm(client).Cart.where({ id: cartId }).first();
    if (!row || row.status !== CART_STATUS_CONVERTED) {
      throw orderAlreadyCreated();
    }
  }

  async listOwnedOrders(
    customerId: string,
    query: OrderListQuery,
  ): Promise<{ items: OrderSummaryView[]; total: number }> {
    const client = this.db();
    const counted = await orm(client)
      .Order.where({ customerId })
      .aggregate((agg) => ({ total: agg.count() }));
    const rows = await orm(client)
      .Order.where({ customerId })
      .orderBy((order) => order.createdAt.desc())
      .offset(query.offset)
      .limit(query.limit)
      .all();
    const summaries = await this.toSummaries(rows, client);
    return { items: summaries, total: Number(counted.total) };
  }

  async findOwnedOrderDetail(
    customerId: string,
    orderId: string,
  ): Promise<OrderDetailView | null> {
    const client = this.db();
    const order = await orm(client)
      .Order.where({ id: orderId, customerId })
      .first();
    if (!order) {
      return null;
    }
    const [summaries, address, itemRows] = await Promise.all([
      this.toSummaries([order], client),
      orm(client)
        .OrderDeliveryAddressSnapshot.where({ orderId: order.id })
        .first(),
      orm(client).OrderItem.where({ orderId: order.id }).all(),
    ]);
    const summary = summaries[0];
    if (!summary || !address) {
      return null;
    }
    const itemIds = itemRows.map((row) => row.id);
    const optionRows =
      itemIds.length === 0
        ? []
        : await orm(client)
            .OrderItemOption.where((option) => option.orderItemId.in(itemIds))
            .all();
    const optionsByItem = new Map<string, OrderItemView['options']>();
    for (const option of optionRows) {
      const list = optionsByItem.get(option.orderItemId) ?? [];
      list.push({
        optionNameSnapshot: option.optionNameSnapshot,
        additionalPriceMinor: parseMinorUnits(option.additionalPriceMinor),
      });
      optionsByItem.set(option.orderItemId, list);
    }
    const items: OrderItemView[] = itemRows.map((row) => ({
      id: row.id,
      productId: row.productId,
      productNameSnapshot: row.productNameSnapshot,
      quantity: row.quantity,
      unitPriceMinor: parseMinorUnits(row.unitPriceMinor),
      lineTotalMinor: parseMinorUnits(row.lineTotalMinor),
      options: optionsByItem.get(row.id) ?? [],
    }));
    return {
      ...summary,
      merchantBranchId: order.merchantBranchId,
      items,
      deliveryAddress: {
        addressText: address.addressText,
        latitude: parseCoordinate(address.latitude),
        longitude: parseCoordinate(address.longitude),
        instructions: address.instructions,
      },
    };
  }

  private async toSummaries(
    orders: Array<{
      id: string;
      publicReference: string;
      status: string;
      fulfillmentStatus: string;
      createdAt: string;
    }>,
    client: OrmClient,
  ): Promise<OrderSummaryView[]> {
    if (orders.length === 0) {
      return [];
    }
    const ids = orders.map((order) => order.id);
    const [financials, payments] = await Promise.all([
      orm(client)
        .OrderFinancialSnapshot.where((row) => row.orderId.in(ids))
        .all(),
      orm(client)
        .Payment.where((row) => row.orderId.in(ids))
        .all(),
    ]);
    const financialByOrder = new Map(
      financials.map((row) => [row.orderId, row]),
    );
    const paymentByOrder = new Map(payments.map((row) => [row.orderId, row]));
    const summaries: OrderSummaryView[] = [];
    for (const order of orders) {
      const financial = financialByOrder.get(order.id);
      const payment = paymentByOrder.get(order.id);
      if (!financial || !payment) {
        continue;
      }
      summaries.push({
        id: order.id,
        publicReference: order.publicReference,
        status: order.status,
        fulfillmentStatus: order.fulfillmentStatus,
        paymentMethod: payment.method,
        createdAt: order.createdAt,
        financial: {
          currency: financial.currency,
          merchandiseSubtotalMinor: parseMinorUnits(
            financial.grossMerchandiseSubtotalMinor,
          ),
          deliveryFeeMinor: parseMinorUnits(financial.customerDeliveryFeeMinor),
          customerTotalMinor: parseMinorUnits(financial.customerPayableMinor),
        },
      });
    }
    return summaries;
  }

  async lockOrder(
    orderId: string,
    client: OrmClient,
  ): Promise<{
    id: string;
    customerId: string;
    merchantBranchId: string;
    status: string;
    fulfillmentStatus: string;
    publicReference: string;
    createdAt: string;
    confirmedAt: string | null;
    updatedAt: string;
  } | null> {
    await orm(client).Order.where({ id: orderId }).update({
      updatedAt: pgNow(),
    });
    const row = await orm(client).Order.where({ id: orderId }).first();
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      customerId: row.customerId,
      merchantBranchId: row.merchantBranchId,
      status: row.status,
      fulfillmentStatus: row.fulfillmentStatus,
      publicReference: row.publicReference,
      createdAt: row.createdAt,
      confirmedAt: row.confirmedAt,
      updatedAt: row.updatedAt,
    };
  }

  async findMerchantById(
    merchantId: string,
    client: OrmClient,
  ): Promise<{ id: string; status: string; verifiedAt: string | null } | null> {
    const row = await orm(client).Merchant.where({ id: merchantId }).first();
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      status: row.status,
      verifiedAt: row.verifiedAt,
    };
  }

  async findBranchMerchantId(
    branchId: string,
    client?: OrmClient,
  ): Promise<string | null> {
    const row = await orm(client ?? this.db())
      .MerchantBranch.where({ id: branchId })
      .first();
    return row?.merchantId ?? null;
  }

  async findOrderMerchantId(
    orderId: string,
    client: OrmClient,
  ): Promise<string | null> {
    const order = await orm(client).Order.where({ id: orderId }).first();
    if (!order) {
      return null;
    }
    return this.findBranchMerchantId(order.merchantBranchId, client);
  }

  async listBranchIdsForMerchant(merchantId: string): Promise<string[]> {
    const rows = await orm(this.db())
      .MerchantBranch.where({ merchantId })
      .all();
    return rows.map((row) => row.id);
  }

  async findPaymentByOrderId(
    orderId: string,
    client: OrmClient,
  ): Promise<{ method: string; status: string; amountMinor: bigint } | null> {
    const row = await orm(client).Payment.where({ orderId }).first();
    if (!row) {
      return null;
    }
    return {
      method: row.method,
      status: row.status,
      amountMinor: row.amountMinor,
    };
  }

  async applyMerchantAccept(
    orderId: string,
    actorAccountId: string,
    expectedUpdatedAt: string,
    client: OrmClient,
  ): Promise<boolean> {
    const now = pgNow();
    await orm(client)
      .Order.where({
        id: orderId,
        status: ORDER_STATUS_CREATED,
        fulfillmentStatus: ORDER_FULFILLMENT_PENDING_ACCEPTANCE,
        updatedAt: pgTimestamptz(expectedUpdatedAt),
      })
      .update({
        status: ORDER_STATUS_CONFIRMED,
        fulfillmentStatus: ORDER_FULFILLMENT_ACCEPTED,
        confirmedAt: now,
        updatedAt: now,
      });
    const row = await orm(client).Order.where({ id: orderId }).first();
    if (
      !row ||
      row.status !== ORDER_STATUS_CONFIRMED ||
      row.fulfillmentStatus !== ORDER_FULFILLMENT_ACCEPTED
    ) {
      return false;
    }
    await this.insertMerchantEvent(
      {
        orderId,
        actorAccountId,
        eventType: ORDER_STATUS_EVENT_MERCHANT_ACCEPTED,
        fromStatus: ORDER_STATUS_CREATED,
        toStatus: ORDER_STATUS_CONFIRMED,
      },
      client,
      now,
    );
    return true;
  }

  async applyStartPreparation(
    orderId: string,
    actorAccountId: string,
    expectedUpdatedAt: string,
    client: OrmClient,
  ): Promise<boolean> {
    const now = pgNow();
    await orm(client)
      .Order.where({
        id: orderId,
        status: ORDER_STATUS_CONFIRMED,
        fulfillmentStatus: ORDER_FULFILLMENT_ACCEPTED,
        updatedAt: pgTimestamptz(expectedUpdatedAt),
      })
      .update({
        status: ORDER_STATUS_ACTIVE,
        fulfillmentStatus: ORDER_FULFILLMENT_PREPARING,
        updatedAt: now,
      });
    const row = await orm(client).Order.where({ id: orderId }).first();
    if (
      !row ||
      row.status !== ORDER_STATUS_ACTIVE ||
      row.fulfillmentStatus !== ORDER_FULFILLMENT_PREPARING
    ) {
      return false;
    }
    await this.insertMerchantEvent(
      {
        orderId,
        actorAccountId,
        eventType: ORDER_STATUS_EVENT_PREPARATION_STARTED,
        fromStatus: ORDER_STATUS_CONFIRMED,
        toStatus: ORDER_STATUS_ACTIVE,
      },
      client,
      now,
    );
    return true;
  }

  async applyMarkReady(
    orderId: string,
    actorAccountId: string,
    expectedUpdatedAt: string,
    client: OrmClient,
  ): Promise<boolean> {
    const now = pgNow();
    await orm(client)
      .Order.where({
        id: orderId,
        status: ORDER_STATUS_ACTIVE,
        fulfillmentStatus: ORDER_FULFILLMENT_PREPARING,
        updatedAt: pgTimestamptz(expectedUpdatedAt),
      })
      .update({
        fulfillmentStatus: ORDER_FULFILLMENT_READY,
        updatedAt: now,
      });
    const row = await orm(client).Order.where({ id: orderId }).first();
    if (
      !row ||
      row.status !== ORDER_STATUS_ACTIVE ||
      row.fulfillmentStatus !== ORDER_FULFILLMENT_READY
    ) {
      return false;
    }
    await this.insertMerchantEvent(
      {
        orderId,
        actorAccountId,
        eventType: ORDER_STATUS_EVENT_ORDER_READY,
        fromStatus: ORDER_STATUS_ACTIVE,
        toStatus: ORDER_STATUS_ACTIVE,
      },
      client,
      now,
    );
    return true;
  }

  async applyMerchantReject(
    orderId: string,
    actorAccountId: string,
    reason: string,
    expectedUpdatedAt: string,
    client: OrmClient,
  ): Promise<'APPLIED' | 'NOT_APPLIED' | 'PAYMENT_NOT_PENDING'> {
    const now = pgNow();
    await orm(client)
      .Order.where({
        id: orderId,
        status: ORDER_STATUS_CREATED,
        fulfillmentStatus: ORDER_FULFILLMENT_PENDING_ACCEPTANCE,
        updatedAt: pgTimestamptz(expectedUpdatedAt),
      })
      .update({
        status: ORDER_STATUS_CANCELLED,
        updatedAt: now,
      });
    const row = await orm(client).Order.where({ id: orderId }).first();
    if (
      !row ||
      row.status !== ORDER_STATUS_CANCELLED ||
      row.fulfillmentStatus !== ORDER_FULFILLMENT_PENDING_ACCEPTANCE
    ) {
      return 'NOT_APPLIED';
    }
    await orm(client).OrderCancellation.create({
      id: createUuidV7(),
      orderId,
      reason: pgVarchar<255>(reason),
      internalNote: null,
      cancelledByAccountId: actorAccountId,
      cancelledAt: now,
    });
    await orm(client)
      .Payment.where({
        orderId,
        status: PAYMENT_STATUS_PENDING,
      })
      .update({
        status: PAYMENT_STATUS_CANCELLED,
        updatedAt: now,
      });
    const payment = await orm(client).Payment.where({ orderId }).first();
    if (!payment || payment.status !== PAYMENT_STATUS_CANCELLED) {
      return 'PAYMENT_NOT_PENDING';
    }
    await this.insertMerchantEvent(
      {
        orderId,
        actorAccountId,
        eventType: ORDER_STATUS_EVENT_MERCHANT_REJECTED,
        fromStatus: ORDER_STATUS_CREATED,
        toStatus: ORDER_STATUS_CANCELLED,
      },
      client,
      now,
    );
    return 'APPLIED';
  }

  private async insertMerchantEvent(
    input: {
      orderId: string;
      actorAccountId: string;
      eventType: string;
      fromStatus: string;
      toStatus: string;
    },
    client: OrmClient,
    occurredAt: ReturnType<typeof pgNow>,
  ): Promise<void> {
    await orm(client).OrderStatusEvent.create({
      id: createUuidV7(),
      orderId: input.orderId,
      eventType: pgVarchar<64>(input.eventType),
      actorType: pgVarchar<32>(ORDER_STATUS_EVENT_ACTOR_MERCHANT),
      actorId: input.actorAccountId,
      fromStatus: pgVarchar<32>(input.fromStatus),
      toStatus: pgVarchar<32>(input.toStatus),
      occurredAt,
      metadataJson: null,
    });
  }

  async listMerchantOrders(
    branchIds: string[],
    query: MerchantOrderListQuery,
  ): Promise<{ items: MerchantOrderSummaryView[]; total: number }> {
    if (branchIds.length === 0) {
      return { items: [], total: 0 };
    }
    const client = this.db();
    const counted = await this.merchantOrderCollection(
      branchIds,
      query,
      client,
    ).aggregate((agg) => ({
      total: agg.count(),
    }));
    const rows = await this.merchantOrderCollection(branchIds, query, client)
      .orderBy((order) => order.createdAt.desc())
      .offset(query.offset)
      .limit(query.limit)
      .all();
    return {
      items: await this.toMerchantSummaries(rows, client),
      total: Number(counted.total),
    };
  }

  private merchantOrderCollection(
    branchIds: string[],
    query: MerchantOrderListQuery,
    client: OrmClient,
  ) {
    let collection = orm(client).Order.where((order) =>
      order.merchantBranchId.in(branchIds),
    );
    if (query.orderStatus) {
      collection = collection.where({
        status:
          query.orderStatus as (typeof MERCHANT_ORDER_STATUS_FILTERS)[number],
      });
    }
    if (query.fulfillmentStatus) {
      collection = collection.where({
        fulfillmentStatus:
          query.fulfillmentStatus as (typeof MERCHANT_FULFILLMENT_STATUS_FILTERS)[number],
      });
    }
    return collection;
  }

  async findMerchantOrderDetail(
    orderId: string,
    merchantId: string,
    client?: OrmClient,
  ): Promise<MerchantOrderDetailView | null> {
    const db = client ?? this.db();
    const order = await orm(db).Order.where({ id: orderId }).first();
    if (!order) {
      return null;
    }
    const branchMerchantId = await this.findBranchMerchantId(
      order.merchantBranchId,
      db,
    );
    if (branchMerchantId !== merchantId) {
      return null;
    }
    const [summaries, address, itemRows, eventRows, cancellation] =
      await Promise.all([
        this.toMerchantSummaries([order], db),
        orm(db)
          .OrderDeliveryAddressSnapshot.where({ orderId: order.id })
          .first(),
        orm(db).OrderItem.where({ orderId: order.id }).all(),
        orm(db)
          .OrderStatusEvent.where({ orderId: order.id })
          .orderBy((event) => event.occurredAt.asc())
          .all(),
        orm(db).OrderCancellation.where({ orderId: order.id }).first(),
      ]);
    const summary = summaries[0];
    if (!summary || !address) {
      return null;
    }
    const itemIds = itemRows.map((row) => row.id);
    const optionRows =
      itemIds.length === 0
        ? []
        : await orm(db)
            .OrderItemOption.where((option) => option.orderItemId.in(itemIds))
            .all();
    const optionsByItem = new Map<string, OrderItemView['options']>();
    for (const option of optionRows) {
      const list = optionsByItem.get(option.orderItemId) ?? [];
      list.push({
        optionNameSnapshot: option.optionNameSnapshot,
        additionalPriceMinor: parseMinorUnits(option.additionalPriceMinor),
      });
      optionsByItem.set(option.orderItemId, list);
    }
    const items: OrderItemView[] = itemRows.map((row) => ({
      id: row.id,
      productId: row.productId,
      productNameSnapshot: row.productNameSnapshot,
      quantity: row.quantity,
      unitPriceMinor: parseMinorUnits(row.unitPriceMinor),
      lineTotalMinor: parseMinorUnits(row.lineTotalMinor),
      options: optionsByItem.get(row.id) ?? [],
    }));
    const statusHistory: MerchantOrderStatusEventView[] = eventRows.map(
      (event) => ({
        eventType: event.eventType,
        actorType: event.actorType,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        occurredAt: event.occurredAt,
      }),
    );
    return {
      ...summary,
      items,
      deliveryAddress: {
        addressText: address.addressText,
        latitude: parseCoordinate(address.latitude),
        longitude: parseCoordinate(address.longitude),
        instructions: address.instructions,
      },
      statusHistory,
      cancellation: cancellation
        ? {
            reason: cancellation.reason,
            cancelledAt: cancellation.cancelledAt,
          }
        : null,
    };
  }

  private async toMerchantSummaries(
    orders: Array<{
      id: string;
      publicReference: string;
      status: string;
      fulfillmentStatus: string;
      merchantBranchId: string;
      customerId: string;
      createdAt: string;
      confirmedAt: string | null;
    }>,
    client: OrmClient,
  ): Promise<MerchantOrderSummaryView[]> {
    if (orders.length === 0) {
      return [];
    }
    const ids = orders.map((order) => order.id);
    const customerIds = uniqueSortedIds(
      orders.map((order) => order.customerId),
    );
    const [financials, payments, profiles] = await Promise.all([
      orm(client)
        .OrderFinancialSnapshot.where((row) => row.orderId.in(ids))
        .all(),
      orm(client)
        .Payment.where((row) => row.orderId.in(ids))
        .all(),
      customerIds.length === 0
        ? Promise.resolve([])
        : orm(client)
            .CustomerProfile.where((row) => row.id.in(customerIds))
            .all(),
    ]);
    const financialByOrder = new Map(
      financials.map((row) => [row.orderId, row]),
    );
    const paymentByOrder = new Map(payments.map((row) => [row.orderId, row]));
    const nameByCustomer = new Map(
      profiles.map((row) => [row.id, row.fullName]),
    );
    const summaries: MerchantOrderSummaryView[] = [];
    for (const order of orders) {
      const financial = financialByOrder.get(order.id);
      const payment = paymentByOrder.get(order.id);
      if (!financial || !payment) {
        continue;
      }
      summaries.push({
        id: order.id,
        publicReference: order.publicReference,
        status: order.status,
        fulfillmentStatus: order.fulfillmentStatus,
        merchantBranchId: order.merchantBranchId,
        createdAt: order.createdAt,
        confirmedAt: order.confirmedAt,
        customerFullName: nameByCustomer.get(order.customerId) ?? null,
        payment: {
          method: payment.method,
          status: payment.status,
        },
        financial: {
          currency: financial.currency,
          grossMerchandiseSubtotalMinor: parseMinorUnits(
            financial.grossMerchandiseSubtotalMinor,
          ),
          merchantDiscountMinor: parseMinorUnits(
            financial.merchantDiscountMinor,
          ),
          merchantCommissionRateBps: financial.merchantCommissionRateBps,
          merchantCommissionAmountMinor: parseMinorUnits(
            financial.merchantCommissionAmountMinor,
          ),
          merchantNetAmountMinor: parseMinorUnits(
            financial.merchantNetAmountMinor,
          ),
          deliveryFeeMinor: parseMinorUnits(financial.customerDeliveryFeeMinor),
        },
      });
    }
    return summaries;
  }
}
