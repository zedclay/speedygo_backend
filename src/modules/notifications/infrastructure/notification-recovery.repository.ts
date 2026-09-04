import { Injectable } from '@nestjs/common';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import {
  NOTIFICATION_TYPE_DRIVER_EARNING_CREATED,
  NOTIFICATION_TYPE_MATCH_OFFER,
  NOTIFICATION_TYPE_PAYMENT_SUCCEEDED,
  NOTIFICATION_TYPE_REFUND_REFUNDED,
} from '../domain/notification.types';
import { notificationConfigurationInvalid } from '../domain/notification.errors';

export type OrderNotifyCandidate = {
  orderId: string;
  customerId: string;
  publicReference: string;
};

export type MerchantOrderCandidate = {
  orderId: string;
};

export type PaymentNotifyCandidate = {
  paymentId: string;
};

export type RefundNotifyCandidate = {
  refundId: string;
};

export type SettlementNotifyCandidate = {
  settlementId: string;
  merchantId: string;
};

export type DriverEarningNotifyCandidate = {
  earningId: string;
  driverId: string;
};

export type MatchOfferNotifyCandidate = {
  assignmentId: string;
  driverId: string;
  assignedAt: string;
  status: string;
  releasedAt: string | null;
};

async function consumeQueryRows<T>(result: unknown): Promise<T[]> {
  if (Array.isArray(result)) {
    return result as T[];
  }
  if (
    result != null &&
    typeof (result as Promise<unknown>).then === 'function'
  ) {
    return consumeQueryRows(await (result as Promise<unknown>));
  }
  if (
    result != null &&
    typeof result === 'object' &&
    Symbol.asyncIterator in result
  ) {
    const rows: T[] = [];
    for await (const row of result as AsyncIterable<T>) {
      rows.push(row);
    }
    return rows;
  }
  throw notificationConfigurationInvalid(
    'Notification recovery query returned an unexpected result',
  );
}

@Injectable()
export class NotificationRecoveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  /**
   * Recent sources missing the canonical IN_APP Notification for the owning Customer.
   * Bounded by lookback + limit. Not a historical backfill.
   */
  async listMissingCustomerOrderEvents(input: {
    eventType: string;
    notificationType: string;
    lookbackIso: string;
    limit: number;
  }): Promise<OrderNotifyCandidate[]> {
    const plan = this.db().raw.sql`
      SELECT o.id AS "orderId",
             o.customer_id AS "customerId",
             o.public_reference AS "publicReference"
      FROM order_status_events e
      INNER JOIN orders o ON o.id = e.order_id
      INNER JOIN customer_profiles cp ON cp.id = o.customer_id
      WHERE e.event_type = ${input.eventType}
        AND e.occurred_at >= ${input.lookbackIso}::timestamptz
        AND NOT EXISTS (
          SELECT 1
          FROM notifications n
          WHERE n.account_id = cp.account_id
            AND n.category = (${input.notificationType} || ':' || o.id::text)
        )
      ORDER BY e.occurred_at DESC
      LIMIT ${input.limit}
    `
      .returnsRow({
        orderId: 'pg/uuid@1',
        customerId: 'pg/uuid@1',
        publicReference: 'pg/varchar@1',
      })
      .build();
    return consumeQueryRows<OrderNotifyCandidate>(
      this.db().runtime().query(plan),
    );
  }

  async listRecentOrdersForMerchantNotify(input: {
    lookbackIso: string;
    limit: number;
  }): Promise<MerchantOrderCandidate[]> {
    const plan = this.db().raw.sql`
      SELECT o.id AS "orderId"
      FROM orders o
      WHERE o.created_at >= ${input.lookbackIso}::timestamptz
      ORDER BY o.created_at DESC
      LIMIT ${input.limit}
    `
      .returnsRow({
        orderId: 'pg/uuid@1',
      })
      .build();
    return consumeQueryRows<MerchantOrderCandidate>(
      this.db().runtime().query(plan),
    );
  }

  async listMissingPaymentSucceeded(input: {
    lookbackIso: string;
    limit: number;
  }): Promise<PaymentNotifyCandidate[]> {
    const type = NOTIFICATION_TYPE_PAYMENT_SUCCEEDED;
    const plan = this.db().raw.sql`
      SELECT p.id AS "paymentId"
      FROM payments p
      INNER JOIN orders o ON o.id = p.order_id
      INNER JOIN customer_profiles cp ON cp.id = o.customer_id
      WHERE p.status = 'SUCCEEDED'
        AND p.updated_at >= ${input.lookbackIso}::timestamptz
        AND NOT EXISTS (
          SELECT 1
          FROM notifications n
          WHERE n.account_id = cp.account_id
            AND n.category = (${type} || ':' || p.id::text)
        )
      ORDER BY p.updated_at DESC
      LIMIT ${input.limit}
    `
      .returnsRow({
        paymentId: 'pg/uuid@1',
      })
      .build();
    return consumeQueryRows<PaymentNotifyCandidate>(
      this.db().runtime().query(plan),
    );
  }

  async listMissingRefundRefunded(input: {
    lookbackIso: string;
    limit: number;
  }): Promise<RefundNotifyCandidate[]> {
    const type = NOTIFICATION_TYPE_REFUND_REFUNDED;
    const plan = this.db().raw.sql`
      SELECT r.id AS "refundId"
      FROM refunds r
      INNER JOIN orders o ON o.id = r.order_id
      INNER JOIN customer_profiles cp ON cp.id = o.customer_id
      WHERE r.status = 'REFUNDED'
        AND COALESCE(r.completed_at, r.created_at) >= ${input.lookbackIso}::timestamptz
        AND NOT EXISTS (
          SELECT 1
          FROM notifications n
          WHERE n.account_id = cp.account_id
            AND n.category = (${type} || ':' || r.id::text)
        )
      ORDER BY COALESCE(r.completed_at, r.created_at) DESC
      LIMIT ${input.limit}
    `
      .returnsRow({
        refundId: 'pg/uuid@1',
      })
      .build();
    return consumeQueryRows<RefundNotifyCandidate>(
      this.db().runtime().query(plan),
    );
  }

  async listRecentFinalizedSettlements(input: {
    lookbackIso: string;
    limit: number;
  }): Promise<SettlementNotifyCandidate[]> {
    const plan = this.db().raw.sql`
      SELECT s.id AS "settlementId",
             s.merchant_id AS "merchantId"
      FROM merchant_settlements s
      WHERE s.status = 'FINALIZED'
        AND s.created_at >= ${input.lookbackIso}::timestamptz
      ORDER BY s.created_at DESC
      LIMIT ${input.limit}
    `
      .returnsRow({
        settlementId: 'pg/uuid@1',
        merchantId: 'pg/uuid@1',
      })
      .build();
    return consumeQueryRows<SettlementNotifyCandidate>(
      this.db().runtime().query(plan),
    );
  }

  async listMissingDriverEarnings(input: {
    lookbackIso: string;
    limit: number;
  }): Promise<DriverEarningNotifyCandidate[]> {
    const type = NOTIFICATION_TYPE_DRIVER_EARNING_CREATED;
    const plan = this.db().raw.sql`
      SELECT e.id AS "earningId",
             e.driver_id AS "driverId"
      FROM driver_earnings e
      INNER JOIN driver_profiles dp ON dp.id = e.driver_id
      WHERE e.created_at >= ${input.lookbackIso}::timestamptz
        AND NOT EXISTS (
          SELECT 1
          FROM notifications n
          WHERE n.account_id = dp.account_id
            AND n.category = (${type} || ':' || e.id::text)
        )
      ORDER BY e.created_at DESC
      LIMIT ${input.limit}
    `
      .returnsRow({
        earningId: 'pg/uuid@1',
        driverId: 'pg/uuid@1',
      })
      .build();
    return consumeQueryRows<DriverEarningNotifyCandidate>(
      this.db().runtime().query(plan),
    );
  }

  async listMissingDeliveryEvents(input: {
    eventType: string;
    notificationType: string;
    lookbackIso: string;
    limit: number;
  }): Promise<OrderNotifyCandidate[]> {
    const plan = this.db().raw.sql`
      SELECT o.id AS "orderId",
             o.customer_id AS "customerId",
             o.public_reference AS "publicReference"
      FROM delivery_events de
      INNER JOIN deliveries d ON d.id = de.delivery_id
      INNER JOIN orders o ON o.id = d.order_id
      INNER JOIN customer_profiles cp ON cp.id = o.customer_id
      WHERE de.type = ${input.eventType}
        AND de.occurred_at >= ${input.lookbackIso}::timestamptz
        AND NOT EXISTS (
          SELECT 1
          FROM notifications n
          WHERE n.account_id = cp.account_id
            AND n.category = (${input.notificationType} || ':' || o.id::text)
        )
      ORDER BY de.occurred_at DESC
      LIMIT ${input.limit}
    `
      .returnsRow({
        orderId: 'pg/uuid@1',
        customerId: 'pg/uuid@1',
        publicReference: 'pg/varchar@1',
      })
      .build();
    return consumeQueryRows<OrderNotifyCandidate>(
      this.db().runtime().query(plan),
    );
  }

  /**
   * Open OFFERED assignments that may still be valid (application checks expiry).
   */
  async listOpenMatchOffers(input: {
    offeredSinceIso: string;
    limit: number;
  }): Promise<MatchOfferNotifyCandidate[]> {
    const type = NOTIFICATION_TYPE_MATCH_OFFER;
    const plan = this.db().raw.sql`
      SELECT a.id AS "assignmentId",
             a.driver_id AS "driverId",
             a.assigned_at AS "assignedAt",
             a.status AS "status",
             a.released_at AS "releasedAt"
      FROM driver_assignments a
      INNER JOIN driver_profiles dp ON dp.id = a.driver_id
      WHERE a.status = 'OFFERED'
        AND a.released_at IS NULL
        AND a.assigned_at >= ${input.offeredSinceIso}::timestamptz
        AND NOT EXISTS (
          SELECT 1
          FROM notifications n
          WHERE n.account_id = dp.account_id
            AND n.category = (${type} || ':' || a.id::text)
        )
      ORDER BY a.assigned_at DESC
      LIMIT ${input.limit}
    `
      .returnsRow({
        assignmentId: 'pg/uuid@1',
        driverId: 'pg/uuid@1',
        assignedAt: 'pg/timestamptz-string@1',
        status: 'pg/varchar@1',
        releasedAt: { codecId: 'pg/timestamptz-string@1', nullable: true },
      })
      .build();
    return consumeQueryRows<MatchOfferNotifyCandidate>(
      this.db().runtime().query(plan),
    );
  }
}
