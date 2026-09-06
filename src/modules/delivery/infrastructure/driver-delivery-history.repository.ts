import { Injectable } from '@nestjs/common';
import { moneyMinorToDecimalString } from '../../../common/money/money-minor';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import { ASSIGNMENT_STATUS_RELEASED } from '../domain/driver-delivery.policy';
import { DELIVERY_STATUS_DELIVERED } from '../domain/driver-delivery-history.policy';
import {
  DRIVER_DELIVERY_HISTORY_CURRENCY_DZD,
  type DriverDeliveryHistoryListQuery,
} from '../domain/driver-delivery-history.types';

export type OrmClient = {
  orm: SpeedyGoDb['orm'];
  query?: (plan: unknown) => AsyncIterable<unknown>;
};

export type DriverDeliveryHistoryRow = {
  deliveryId: string;
  orderId: string;
  orderPublicReference: string;
  deliveryStatus: string;
  deliveredAt: string;
  pickedUpAt: string | null;
  arrivedCustomerAt: string | null;
  merchantName: string;
  branchName: string;
  paymentMethod: string | null;
  assignmentId: string;
  servingDriverId: string;
  earningId: string;
  earningDriverId: string;
  earningStatus: string;
  earningAmountMinor: bigint;
  earnedAt: string;
};

async function consumeQueryRows<T>(
  iterable: AsyncIterable<unknown>,
): Promise<T[]> {
  const rows: T[] = [];
  for await (const row of iterable) {
    rows.push(row as T);
  }
  return rows;
}

@Injectable()
export class DriverDeliveryHistoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async runConsistentRead<T>(fn: (tx: OrmClient) => Promise<T>): Promise<T> {
    return this.db().transaction(async (tx: OrmClient) => fn(tx));
  }

  private async queryRows<T>(plan: unknown, client?: OrmClient): Promise<T[]> {
    if (client?.query) {
      return consumeQueryRows<T>(client.query(plan));
    }
    return consumeQueryRows<T>(
      this.db()
        .runtime()
        .query(plan as never),
    );
  }

  async countCompletedHistory(
    driverId: string,
    page: DriverDeliveryHistoryListQuery,
    client?: OrmClient,
  ): Promise<number> {
    const plan = this.buildCountPlan(driverId, page);
    const rows = await this.queryRows<{ total: number }>(plan, client);
    return Number(rows[0]?.total ?? 0);
  }

  async listCompletedHistory(
    driverId: string,
    page: DriverDeliveryHistoryListQuery,
    client?: OrmClient,
  ): Promise<DriverDeliveryHistoryRow[]> {
    const plan = this.buildListPlan(driverId, page);
    const rows = await this.queryRows<{
      delivery_id: string;
      order_id: string;
      order_public_reference: string;
      delivery_status: string;
      delivered_at: string;
      picked_up_at: string | null;
      arrived_customer_at: string | null;
      merchant_name: string;
      branch_name: string;
      payment_method: string | null;
      assignment_id: string;
      serving_driver_id: string;
      earning_id: string;
      earning_driver_id: string;
      earning_status: string;
      net_earning_minor: bigint | string | number;
      earned_at: string;
    }>(plan, client);
    return rows.map((row) => this.toRow(row));
  }

  async findCompletedHistoryByDeliveryId(
    driverId: string,
    deliveryId: string,
    client?: OrmClient,
  ): Promise<DriverDeliveryHistoryRow | null> {
    const plan = this.db().raw.sql`
        SELECT
          d.id AS delivery_id,
          d.order_id,
          o.public_reference AS order_public_reference,
          d.status::text AS delivery_status,
          d.delivered_at,
          d.picked_up_at,
          d.arrived_customer_at,
          m.name AS merchant_name,
          mb.name AS branch_name,
          p.method AS payment_method,
          a.id AS assignment_id,
          a.driver_id AS serving_driver_id,
          e.id AS earning_id,
          e.driver_id AS earning_driver_id,
          e.status AS earning_status,
          e.net_earning_minor,
          COALESCE(e.validated_at, e.created_at) AS earned_at
        FROM deliveries d
        INNER JOIN driver_assignments a
          ON a.delivery_id = d.id
         AND a.driver_id = ${driverId}::uuid
         AND a.status = ${ASSIGNMENT_STATUS_RELEASED}
         AND a.accepted_at IS NOT NULL
         AND a.released_at IS NOT NULL
        INNER JOIN driver_earnings e
          ON e.delivery_id = d.id
         AND e.driver_id = a.driver_id
        INNER JOIN orders o ON o.id = d.order_id
        INNER JOIN merchant_branches mb ON mb.id = o.merchant_branch_id
        INNER JOIN merchants m ON m.id = mb.merchant_id
        LEFT JOIN payments p ON p.order_id = o.id
        WHERE d.id = ${deliveryId}::uuid
          AND d.status = ${DELIVERY_STATUS_DELIVERED}
          AND d.delivered_at IS NOT NULL
      `
      .returnsRow({
        delivery_id: 'pg/uuid@1',
        order_id: 'pg/uuid@1',
        order_public_reference: 'sql/varchar@1',
        delivery_status: 'pg/text@1',
        delivered_at: 'pg/timestamptz-string@1',
        picked_up_at: { codecId: 'pg/timestamptz-string@1', nullable: true },
        arrived_customer_at: {
          codecId: 'pg/timestamptz-string@1',
          nullable: true,
        },
        merchant_name: 'sql/varchar@1',
        branch_name: 'sql/varchar@1',
        payment_method: { codecId: 'sql/varchar@1', nullable: true },
        assignment_id: 'pg/uuid@1',
        serving_driver_id: 'pg/uuid@1',
        earning_id: 'pg/uuid@1',
        earning_driver_id: 'pg/uuid@1',
        earning_status: 'sql/varchar@1',
        net_earning_minor: 'pg/int8@1',
        earned_at: 'pg/timestamptz-string@1',
      })
      .build();
    const rows = await this.queryRows<{
      delivery_id: string;
      order_id: string;
      order_public_reference: string;
      delivery_status: string;
      delivered_at: string;
      picked_up_at: string | null;
      arrived_customer_at: string | null;
      merchant_name: string;
      branch_name: string;
      payment_method: string | null;
      assignment_id: string;
      serving_driver_id: string;
      earning_id: string;
      earning_driver_id: string;
      earning_status: string;
      net_earning_minor: bigint | string | number;
      earned_at: string;
    }>(plan, client);
    return rows[0] ? this.toRow(rows[0]) : null;
  }

  /**
   * Count RELEASED assignments that match the Delivery's DriverEarning owner.
   * Non-serving accepted-then-released peers (RELEASED without earning) are excluded.
   */
  async countCompletingServingAssignments(
    deliveryId: string,
    client?: OrmClient,
  ): Promise<number> {
    const plan = this.db().raw.sql`
        SELECT COUNT(*)::int4 AS total
        FROM driver_assignments a
        INNER JOIN driver_earnings e
          ON e.delivery_id = a.delivery_id
         AND e.driver_id = a.driver_id
        WHERE a.delivery_id = ${deliveryId}::uuid
          AND a.status = ${ASSIGNMENT_STATUS_RELEASED}
          AND a.accepted_at IS NOT NULL
          AND a.released_at IS NOT NULL
      `
      .returnsRow({ total: 'pg/int4@1' })
      .build();
    const rows = await this.queryRows<{ total: number }>(plan, client);
    return Number(rows[0]?.total ?? 0);
  }

  private buildCountPlan(
    driverId: string,
    page: DriverDeliveryHistoryListQuery,
  ) {
    const fromIso = page.from
      ? page.from.toISOString()
      : '1970-01-01T00:00:00.000Z';
    const toIso = page.to ? page.to.toISOString() : '9999-12-31T23:59:59.999Z';
    return this.db().raw.sql`
        SELECT COUNT(*)::int4 AS total
        FROM deliveries d
        INNER JOIN driver_assignments a
          ON a.delivery_id = d.id
         AND a.driver_id = ${driverId}::uuid
         AND a.status = ${ASSIGNMENT_STATUS_RELEASED}
         AND a.accepted_at IS NOT NULL
         AND a.released_at IS NOT NULL
        INNER JOIN driver_earnings e
          ON e.delivery_id = d.id
         AND e.driver_id = a.driver_id
        WHERE d.status = ${DELIVERY_STATUS_DELIVERED}
          AND d.delivered_at IS NOT NULL
          AND d.delivered_at >= ${fromIso}::timestamptz
          AND d.delivered_at < ${toIso}::timestamptz
      `
      .returnsRow({ total: 'pg/int4@1' })
      .build();
  }

  private buildListPlan(
    driverId: string,
    page: DriverDeliveryHistoryListQuery,
  ) {
    const fromIso = page.from
      ? page.from.toISOString()
      : '1970-01-01T00:00:00.000Z';
    const toIso = page.to ? page.to.toISOString() : '9999-12-31T23:59:59.999Z';
    return this.db().raw.sql`
        SELECT
          d.id AS delivery_id,
          d.order_id,
          o.public_reference AS order_public_reference,
          d.status::text AS delivery_status,
          d.delivered_at,
          d.picked_up_at,
          d.arrived_customer_at,
          m.name AS merchant_name,
          mb.name AS branch_name,
          p.method AS payment_method,
          a.id AS assignment_id,
          a.driver_id AS serving_driver_id,
          e.id AS earning_id,
          e.driver_id AS earning_driver_id,
          e.status AS earning_status,
          e.net_earning_minor,
          COALESCE(e.validated_at, e.created_at) AS earned_at
        FROM deliveries d
        INNER JOIN driver_assignments a
          ON a.delivery_id = d.id
         AND a.driver_id = ${driverId}::uuid
         AND a.status = ${ASSIGNMENT_STATUS_RELEASED}
         AND a.accepted_at IS NOT NULL
         AND a.released_at IS NOT NULL
        INNER JOIN driver_earnings e
          ON e.delivery_id = d.id
         AND e.driver_id = a.driver_id
        INNER JOIN orders o ON o.id = d.order_id
        INNER JOIN merchant_branches mb ON mb.id = o.merchant_branch_id
        INNER JOIN merchants m ON m.id = mb.merchant_id
        LEFT JOIN payments p ON p.order_id = o.id
        WHERE d.status = ${DELIVERY_STATUS_DELIVERED}
          AND d.delivered_at IS NOT NULL
          AND d.delivered_at >= ${fromIso}::timestamptz
          AND d.delivered_at < ${toIso}::timestamptz
        ORDER BY d.delivered_at DESC, d.id DESC
        LIMIT ${page.limit}
        OFFSET ${page.offset}
      `
      .returnsRow({
        delivery_id: 'pg/uuid@1',
        order_id: 'pg/uuid@1',
        order_public_reference: 'sql/varchar@1',
        delivery_status: 'pg/text@1',
        delivered_at: 'pg/timestamptz-string@1',
        picked_up_at: { codecId: 'pg/timestamptz-string@1', nullable: true },
        arrived_customer_at: {
          codecId: 'pg/timestamptz-string@1',
          nullable: true,
        },
        merchant_name: 'sql/varchar@1',
        branch_name: 'sql/varchar@1',
        payment_method: { codecId: 'sql/varchar@1', nullable: true },
        assignment_id: 'pg/uuid@1',
        serving_driver_id: 'pg/uuid@1',
        earning_id: 'pg/uuid@1',
        earning_driver_id: 'pg/uuid@1',
        earning_status: 'sql/varchar@1',
        net_earning_minor: 'pg/int8@1',
        earned_at: 'pg/timestamptz-string@1',
      })
      .build();
  }

  private toRow(row: {
    delivery_id: string;
    order_id: string;
    order_public_reference: string;
    delivery_status: string;
    delivered_at: string;
    picked_up_at: string | null;
    arrived_customer_at: string | null;
    merchant_name: string;
    branch_name: string;
    payment_method: string | null;
    assignment_id: string;
    serving_driver_id: string;
    earning_id: string;
    earning_driver_id: string;
    earning_status: string;
    net_earning_minor: bigint | string | number;
    earned_at: string;
  }): DriverDeliveryHistoryRow {
    const rawAmount =
      typeof row.net_earning_minor === 'bigint'
        ? row.net_earning_minor.toString(10)
        : String(row.net_earning_minor);
    return {
      deliveryId: String(row.delivery_id),
      orderId: String(row.order_id),
      orderPublicReference: String(row.order_public_reference),
      deliveryStatus: String(row.delivery_status),
      deliveredAt: String(row.delivered_at),
      pickedUpAt: row.picked_up_at ? String(row.picked_up_at) : null,
      arrivedCustomerAt: row.arrived_customer_at
        ? String(row.arrived_customer_at)
        : null,
      merchantName: String(row.merchant_name),
      branchName: String(row.branch_name),
      paymentMethod: row.payment_method ? String(row.payment_method) : null,
      assignmentId: String(row.assignment_id),
      servingDriverId: String(row.serving_driver_id),
      earningId: String(row.earning_id),
      earningDriverId: String(row.earning_driver_id),
      earningStatus: String(row.earning_status),
      earningAmountMinor: BigInt(rawAmount),
      earnedAt: String(row.earned_at),
    };
  }

  serializeEarningAmount(amount: bigint): string {
    return moneyMinorToDecimalString(amount);
  }

  currency(): string {
    return DRIVER_DELIVERY_HISTORY_CURRENCY_DZD;
  }
}
