import { Injectable } from '@nestjs/common';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import {
  pgNow,
  pgVarchar,
  type PgTimestamptz,
} from '../../../infrastructure/database/pg-values';
import { parseMinorUnits } from '../../catalog/domain/catalog.policy';
import {
  ORDER_FULFILLMENT_READY,
  ORDER_STATUS_ACTIVE,
  ORDER_STATUS_COMPLETED,
} from '../../orders/domain/order.policy';
import { ASSIGNMENT_STATUS_RELEASED } from '../domain/driver-delivery.policy';
import {
  DELIVERY_EVENT_CREATED,
  DELIVERY_INITIAL_STATUS,
  type DeliveryStatus,
} from '../domain/delivery.policy';
import type { DeliveryDetailView } from '../domain/delivery.types';

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
export class DeliveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  runInTransaction<T>(fn: (tx: OrmClient) => Promise<T>): Promise<T> {
    return this.db().transaction((tx) => fn(tx));
  }

  async findProfileIdByAccountId(accountId: string): Promise<string | null> {
    const row = await orm(this.db())
      .CustomerProfile.where({ accountId })
      .first();
    return row?.id ?? null;
  }

  async findOrderRecord(
    orderId: string,
    client?: OrmClient,
  ): Promise<{
    id: string;
    customerId: string;
    merchantBranchId: string;
    status: string;
    fulfillmentStatus: string;
    publicReference: string;
  } | null> {
    const row = await orm(client ?? this.db())
      .Order.where({ id: orderId })
      .first();
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
    };
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
      updatedAt: row.updatedAt,
    };
  }

  async lockPayment(
    orderId: string,
    client: OrmClient,
  ): Promise<{ method: string; status: string } | null> {
    await orm(client).Payment.where({ orderId }).update({
      updatedAt: pgNow(),
    });
    const row = await orm(client).Payment.where({ orderId }).first();
    if (!row) {
      return null;
    }
    return { method: row.method, status: row.status };
  }

  async findAddressSnapshot(
    orderId: string,
    client: OrmClient,
  ): Promise<boolean> {
    const row = await orm(client)
      .OrderDeliveryAddressSnapshot.where({ orderId })
      .first();
    return Boolean(row);
  }

  async findDeliveryIdByOrderId(
    orderId: string,
    client?: OrmClient,
  ): Promise<string | null> {
    const row = await orm(client ?? this.db())
      .Delivery.where({ orderId })
      .first();
    return row?.id ?? null;
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

  async insertDeliveryWithCreatedEvent(
    orderId: string,
    client: OrmClient,
  ): Promise<string> {
    const now = pgNow();
    const deliveryId = createUuidV7();
    await orm(client).Delivery.create({
      id: deliveryId,
      orderId,
      status: DELIVERY_INITIAL_STATUS,
      driverSearchStartedAt: now,
      pickedUpAt: null,
      estimatedArrivalAt: null,
      arrivedCustomerAt: null,
      deliveredAt: null,
      createdAt: now,
      updatedAt: now,
    });
    await this.appendEvent(
      {
        deliveryId,
        type: DELIVERY_EVENT_CREATED,
        occurredAt: now,
      },
      client,
    );
    return deliveryId;
  }

  async appendEvent(
    input: {
      deliveryId: string;
      type: string;
      occurredAt: PgTimestamptz;
      driverId?: string | null;
    },
    client: OrmClient,
  ): Promise<void> {
    await orm(client).DeliveryEvent.create({
      id: createUuidV7(),
      deliveryId: input.deliveryId,
      type: pgVarchar<64>(input.type),
      driverId: input.driverId ?? null,
      occurredAt: input.occurredAt,
      metadataJson: null,
    });
  }

  async lockDelivery(
    deliveryId: string,
    client: OrmClient,
  ): Promise<{ id: string; orderId: string; status: string } | null> {
    await orm(client).Delivery.where({ id: deliveryId }).update({
      updatedAt: pgNow(),
    });
    const row = await orm(client).Delivery.where({ id: deliveryId }).first();
    if (!row) {
      return null;
    }
    return { id: row.id, orderId: row.orderId, status: row.status };
  }

  async findDeliveryById(
    deliveryId: string,
    client?: OrmClient,
  ): Promise<{ id: string; orderId: string; status: string } | null> {
    const row = await orm(client ?? this.db())
      .Delivery.where({ id: deliveryId })
      .first();
    return row
      ? { id: row.id, orderId: row.orderId, status: row.status }
      : null;
  }

  async listReadyOrderIdsMissingDelivery(limit: number): Promise<string[]> {
    const sqlClient = this.db();
    const plan = sqlClient.raw.sql`
      SELECT o.id
      FROM orders o
      WHERE o.status = ${ORDER_STATUS_ACTIVE}
        AND o.fulfillment_status = ${ORDER_FULFILLMENT_READY}
        AND NOT EXISTS (
          SELECT 1 FROM deliveries d WHERE d.order_id = o.id
        )
      ORDER BY o.updated_at DESC
      LIMIT ${limit}
    `
      .returnsRow({
        id: 'pg/uuid@1',
      })
      .build();
    const rows = await sqlClient.runtime().query(plan);
    return rows.map((row) => row.id);
  }

  async listSearchingDeliveryIds(limit: number): Promise<string[]> {
    const rows = await orm(this.db())
      .Delivery.where({ status: DELIVERY_INITIAL_STATUS })
      .orderBy((delivery) => delivery.updatedAt.asc())
      .limit(limit)
      .all();
    return rows.map((row) => row.id);
  }

  async findMatchingContext(deliveryId: string): Promise<{
    deliveryId: string;
    orderId: string;
    publicReference: string;
    deliveryStatus: string;
    orderStatus: string;
    fulfillmentStatus: string;
    pickup: {
      merchantBranchId: string;
      name: string;
      addressText: string;
      latitude: number;
      longitude: number;
    };
    dropoff: {
      addressText: string;
      latitude: number;
      longitude: number;
    };
    driverRemunerationMinor: number;
  } | null> {
    const delivery = await orm(this.db())
      .Delivery.where({ id: deliveryId })
      .first();
    if (!delivery) {
      return null;
    }
    const order = await orm(this.db())
      .Order.where({ id: delivery.orderId })
      .first();
    if (!order) {
      return null;
    }
    const [branch, address, financial] = await Promise.all([
      orm(this.db())
        .MerchantBranch.where({ id: order.merchantBranchId })
        .first(),
      orm(this.db())
        .OrderDeliveryAddressSnapshot.where({ orderId: order.id })
        .first(),
      orm(this.db())
        .OrderFinancialSnapshot.where({ orderId: order.id })
        .first(),
    ]);
    if (!branch || !address || !financial) {
      return null;
    }
    return {
      deliveryId: delivery.id,
      orderId: order.id,
      publicReference: order.publicReference,
      deliveryStatus: delivery.status,
      orderStatus: order.status,
      fulfillmentStatus: order.fulfillmentStatus,
      pickup: {
        merchantBranchId: branch.id,
        name: branch.name,
        addressText: branch.addressText,
        latitude: parseCoordinate(branch.latitude),
        longitude: parseCoordinate(branch.longitude),
      },
      dropoff: {
        addressText: address.addressText,
        latitude: parseCoordinate(address.latitude),
        longitude: parseCoordinate(address.longitude),
      },
      driverRemunerationMinor: parseMinorUnits(
        financial.driverRemunerationMinor,
      ),
    };
  }

  async findDeliveryDetail(
    orderId: string,
  ): Promise<DeliveryDetailView | null> {
    const db = this.db();
    const delivery = await orm(db).Delivery.where({ orderId }).first();
    if (!delivery) {
      return null;
    }
    const order = await orm(db).Order.where({ id: orderId }).first();
    if (!order) {
      return null;
    }
    const [branch, address, financial, events] = await Promise.all([
      orm(db).MerchantBranch.where({ id: order.merchantBranchId }).first(),
      orm(db).OrderDeliveryAddressSnapshot.where({ orderId }).first(),
      orm(db).OrderFinancialSnapshot.where({ orderId }).first(),
      orm(db)
        .DeliveryEvent.where({ deliveryId: delivery.id })
        .orderBy((event) => event.occurredAt.asc())
        .all(),
    ]);
    if (!branch || !address) {
      return null;
    }
    const accepted = await orm(db)
      .DriverAssignment.where({
        deliveryId: delivery.id,
        status: pgVarchar<64>('ACCEPTED'),
        releasedAt: null,
      })
      .first();
    return {
      id: delivery.id,
      orderId: order.id,
      publicReference: order.publicReference,
      status: delivery.status,
      orderStatus: order.status,
      fulfillmentStatus: order.fulfillmentStatus,
      assignedDriverId: accepted?.driverId ?? null,
      driverSearchStartedAt: delivery.driverSearchStartedAt,
      pickedUpAt: delivery.pickedUpAt,
      estimatedArrivalAt: delivery.estimatedArrivalAt,
      arrivedCustomerAt: delivery.arrivedCustomerAt,
      deliveredAt: delivery.deliveredAt,
      createdAt: delivery.createdAt,
      updatedAt: delivery.updatedAt,
      pickup: {
        merchantBranchId: branch.id,
        name: branch.name,
        addressText: branch.addressText,
        latitude: parseCoordinate(branch.latitude),
        longitude: parseCoordinate(branch.longitude),
        phone: branch.phone,
      },
      dropoff: {
        addressText: address.addressText,
        latitude: parseCoordinate(address.latitude),
        longitude: parseCoordinate(address.longitude),
        instructions: address.instructions,
      },
      deliveryFeeMinor: financial
        ? parseMinorUnits(financial.customerDeliveryFeeMinor)
        : null,
      events: events.map((event) => ({
        type: event.type,
        occurredAt: event.occurredAt,
        driverId: event.driverId,
      })),
    };
  }

  async transitionIfStatus(
    input: {
      deliveryId: string;
      fromStatus: string;
      toStatus: string;
      eventType: string;
      driverId: string;
      pickedUpAt?: boolean;
      arrivedCustomerAt?: boolean;
      deliveredAt?: boolean;
      occurredAt?: PgTimestamptz;
    },
    client: OrmClient,
  ): Promise<boolean> {
    const current = await orm(client)
      .Delivery.where({ id: input.deliveryId })
      .first();
    if (!current || current.status !== input.fromStatus) {
      return false;
    }
    const now = input.occurredAt ?? pgNow();
    await orm(client)
      .Delivery.where({
        id: input.deliveryId,
        status: input.fromStatus,
      })
      .update({
        status: input.toStatus as DeliveryStatus,
        updatedAt: now,
        ...(input.pickedUpAt ? { pickedUpAt: now } : {}),
        ...(input.arrivedCustomerAt ? { arrivedCustomerAt: now } : {}),
        ...(input.deliveredAt ? { deliveredAt: now } : {}),
      });
    const row = await orm(client)
      .Delivery.where({ id: input.deliveryId })
      .first();
    if (!row || row.status !== input.toStatus) {
      return false;
    }
    await this.appendEvent(
      {
        deliveryId: input.deliveryId,
        type: input.eventType,
        occurredAt: now,
        driverId: input.driverId,
      },
      client,
    );
    return true;
  }

  async releaseAcceptedAssignment(
    assignmentId: string,
    client: OrmClient,
    occurredAt?: PgTimestamptz,
  ): Promise<boolean> {
    const now = occurredAt ?? pgNow();
    await orm(client)
      .DriverAssignment.where({
        id: assignmentId,
        status: pgVarchar<64>('ACCEPTED'),
        releasedAt: null,
      })
      .update({
        status: pgVarchar<64>(ASSIGNMENT_STATUS_RELEASED),
        releasedAt: now,
      });
    const row = await orm(client)
      .DriverAssignment.where({ id: assignmentId })
      .first();
    return Boolean(
      row && row.status === ASSIGNMENT_STATUS_RELEASED && row.releasedAt,
    );
  }

  async completeActiveOrder(
    orderId: string,
    driverId: string,
    client: OrmClient,
    occurredAt?: PgTimestamptz,
  ): Promise<boolean> {
    const now = occurredAt ?? pgNow();
    await orm(client)
      .Order.where({
        id: orderId,
        status: ORDER_STATUS_ACTIVE,
      })
      .update({
        status: ORDER_STATUS_COMPLETED,
        completedAt: now,
        updatedAt: now,
      });
    const row = await orm(client).Order.where({ id: orderId }).first();
    if (!row || row.status !== ORDER_STATUS_COMPLETED) {
      return false;
    }
    await orm(client).OrderStatusEvent.create({
      id: createUuidV7(),
      orderId,
      eventType: pgVarchar<64>('ORDER_COMPLETED'),
      actorType: pgVarchar<32>('DRIVER'),
      actorId: driverId,
      fromStatus: pgVarchar<32>(ORDER_STATUS_ACTIVE),
      toStatus: pgVarchar<32>(ORDER_STATUS_COMPLETED),
      occurredAt: now,
      metadataJson: null,
    });
    return true;
  }

  async countDeliveryEvents(
    deliveryId: string,
    eventType: string,
    client?: OrmClient,
  ): Promise<number> {
    const rows = await orm(client ?? this.db())
      .DeliveryEvent.where({
        deliveryId,
        type: pgVarchar<64>(eventType),
      })
      .all();
    return rows.length;
  }
}
