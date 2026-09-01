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
  pgVarchar,
} from '../../../infrastructure/database/pg-values';
import { parseMinorUnits } from '../../catalog/domain/catalog.policy';
import { CART_STATUS_CONVERTED } from '../../cart/domain/cart.policy';
import type { CheckoutPricingRuleRecord } from '../../checkout/domain/checkout.types';
import { orderAlreadyCreated } from '../domain/order.errors';
import {
  ORDER_FULFILLMENT_PENDING_ACCEPTANCE,
  ORDER_STATUS_CREATED,
  ORDER_STATUS_EVENT_ACTOR_CUSTOMER,
  ORDER_STATUS_EVENT_CREATED,
  PAYMENT_STATUS_PENDING,
} from '../domain/order.policy';
import type {
  OrderAddressRecord,
  OrderCommissionRuleRecord,
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

  async listActiveCommissionRules(
    merchantId: string,
    client: OrmClient,
  ): Promise<OrderCommissionRuleRecord[]> {
    const [overrides, globals] = await Promise.all([
      orm(client)
        .MerchantCommissionRule.where({
          merchantId,
          active: true,
          scope: 'MERCHANT_OVERRIDE',
        })
        .all(),
      orm(client)
        .MerchantCommissionRule.where({
          active: true,
          scope: 'GLOBAL_DEFAULT',
        })
        .all(),
    ]);
    return [...overrides, ...globals].map((row) => ({
      id: row.id,
      scope: row.scope,
      merchantId: row.merchantId,
      rateBps: row.rateBps,
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
}
