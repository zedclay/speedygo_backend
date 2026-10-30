import { Injectable } from '@nestjs/common';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import type { AdminSearchEntityType } from '../domain/admin-search.policy';

export type AdminSearchHitBase = {
  id: string;
  createdAt: string;
  exactMatch: boolean;
};

export type AdminSearchCustomerHit = AdminSearchHitBase & {
  fullName: string;
  phone: string | null;
  accountStatus: string;
};

export type AdminSearchMerchantHit = AdminSearchHitBase & {
  name: string;
  status: string;
  publicReference: string;
};

export type AdminSearchDriverHit = AdminSearchHitBase & {
  fullName: string;
  verificationStatus: string;
};

export type AdminSearchOrderHit = AdminSearchHitBase & {
  publicReference: string;
  status: string;
  fulfillmentStatus: string;
  customerFullName: string | null;
  merchantName: string | null;
};

export type AdminSearchSupportHit = AdminSearchHitBase & {
  publicReference: string;
  subject: string | null;
  status: string;
  priority: string;
};

export type AdminSearchGroupPage<T> = {
  type: AdminSearchEntityType;
  total: number;
  limit: number;
  items: T[];
};

type Needle = {
  text: string;
  like: string;
  uuid: string | null;
  phoneE164: string | null;
  phoneDigits: string | null;
};

/** Bound params never null — flags gate optional predicates (RawSql forbids null). */
function bound(needle: Needle) {
  return {
    text: needle.text,
    like: needle.like,
    matchUuid: needle.uuid ? 1 : 0,
    uuid: needle.uuid ?? '00000000-0000-0000-0000-000000000000',
    matchPhone: needle.phoneE164 ? 1 : 0,
    phoneE164: needle.phoneE164 ?? '',
    matchDigits: needle.phoneDigits ? 1 : 0,
    phoneDigitsLike: needle.phoneDigits
      ? `%${needle.phoneDigits}%`
      : '%__never__%',
  };
}

@Injectable()
export class AdminSearchRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async searchCustomers(
    needle: Needle,
    limit: number,
  ): Promise<AdminSearchGroupPage<AdminSearchCustomerHit>> {
    const db = this.db();
    const b = bound(needle);
    const countPlan = db.raw.sql`
        SELECT COUNT(*)::int8 AS total
        FROM customer_profiles cp
        INNER JOIN accounts a ON a.id = cp.account_id
        WHERE (
          (${b.matchUuid} = 1 AND cp.id = ${b.uuid}::uuid)
          OR cp.full_name ILIKE ${b.like}
          OR (${b.matchPhone} = 1 AND a.phone = ${b.phoneE164})
          OR (
            ${b.matchDigits} = 1
            AND a.phone IS NOT NULL
            AND regexp_replace(a.phone, '\\D', '', 'g') LIKE ${b.phoneDigitsLike}
          )
        )
      `
      .returnsRow({ total: 'pg/int8@1' })
      .build();
    let total = 0;
    for await (const row of db.runtime().query(countPlan)) {
      total = Number(row.total);
    }

    const pagePlan = db.raw.sql`
        SELECT
          cp.id,
          cp.full_name,
          a.phone,
          a.status AS account_status,
          cp.created_at,
          (
            (${b.matchUuid} = 1 AND cp.id = ${b.uuid}::uuid)
            OR (${b.matchPhone} = 1 AND a.phone = ${b.phoneE164})
          ) AS exact_match
        FROM customer_profiles cp
        INNER JOIN accounts a ON a.id = cp.account_id
        WHERE (
          (${b.matchUuid} = 1 AND cp.id = ${b.uuid}::uuid)
          OR cp.full_name ILIKE ${b.like}
          OR (${b.matchPhone} = 1 AND a.phone = ${b.phoneE164})
          OR (
            ${b.matchDigits} = 1
            AND a.phone IS NOT NULL
            AND regexp_replace(a.phone, '\\D', '', 'g') LIKE ${b.phoneDigitsLike}
          )
        )
        ORDER BY exact_match DESC, cp.created_at DESC, cp.id DESC
        LIMIT ${limit}
      `
      .returnsRow({
        id: 'pg/uuid@1',
        full_name: 'sql/varchar@1',
        phone: { codecId: 'sql/varchar@1', nullable: true },
        account_status: 'sql/varchar@1',
        created_at: 'pg/timestamptz-string@1',
        exact_match: 'pg/bool@1',
      })
      .build();

    const items: AdminSearchCustomerHit[] = [];
    for await (const row of db.runtime().query(pagePlan)) {
      items.push({
        id: row.id,
        fullName: row.full_name,
        phone: row.phone,
        accountStatus: row.account_status,
        createdAt: row.created_at,
        exactMatch: Boolean(row.exact_match),
      });
    }
    return { type: 'customers', total, limit, items };
  }

  async searchMerchants(
    needle: Needle,
    limit: number,
  ): Promise<AdminSearchGroupPage<AdminSearchMerchantHit>> {
    const db = this.db();
    const b = bound(needle);
    const countPlan = db.raw.sql`
        SELECT COUNT(*)::int8 AS total
        FROM merchants m
        WHERE (
          (${b.matchUuid} = 1 AND m.id = ${b.uuid}::uuid)
          OR m.name ILIKE ${b.like}
          OR lower(m.public_reference) = lower(${b.text})
          OR m.public_reference ILIKE ${b.like}
        )
      `
      .returnsRow({ total: 'pg/int8@1' })
      .build();
    let total = 0;
    for await (const row of db.runtime().query(countPlan)) {
      total = Number(row.total);
    }

    const pagePlan = db.raw.sql`
        SELECT
          m.id,
          m.name,
          m.status,
          m.public_reference,
          m.created_at,
          (
            (${b.matchUuid} = 1 AND m.id = ${b.uuid}::uuid)
            OR lower(m.public_reference) = lower(${b.text})
          ) AS exact_match
        FROM merchants m
        WHERE (
          (${b.matchUuid} = 1 AND m.id = ${b.uuid}::uuid)
          OR m.name ILIKE ${b.like}
          OR lower(m.public_reference) = lower(${b.text})
          OR m.public_reference ILIKE ${b.like}
        )
        ORDER BY exact_match DESC, m.created_at DESC, m.id DESC
        LIMIT ${limit}
      `
      .returnsRow({
        id: 'pg/uuid@1',
        name: 'sql/varchar@1',
        status: 'sql/varchar@1',
        public_reference: 'sql/varchar@1',
        created_at: 'pg/timestamptz-string@1',
        exact_match: 'pg/bool@1',
      })
      .build();

    const items: AdminSearchMerchantHit[] = [];
    for await (const row of db.runtime().query(pagePlan)) {
      items.push({
        id: row.id,
        name: row.name,
        status: row.status,
        publicReference: row.public_reference,
        createdAt: row.created_at,
        exactMatch: Boolean(row.exact_match),
      });
    }
    return { type: 'merchants', total, limit, items };
  }

  async searchDrivers(
    needle: Needle,
    limit: number,
  ): Promise<AdminSearchGroupPage<AdminSearchDriverHit>> {
    const db = this.db();
    const b = bound(needle);
    const countPlan = db.raw.sql`
        SELECT COUNT(*)::int8 AS total
        FROM driver_profiles dp
        INNER JOIN accounts a ON a.id = dp.account_id
        WHERE (
          (${b.matchUuid} = 1 AND dp.id = ${b.uuid}::uuid)
          OR dp.full_name ILIKE ${b.like}
          OR (${b.matchPhone} = 1 AND a.phone = ${b.phoneE164})
          OR (
            ${b.matchDigits} = 1
            AND a.phone IS NOT NULL
            AND regexp_replace(a.phone, '\\D', '', 'g') LIKE ${b.phoneDigitsLike}
          )
        )
      `
      .returnsRow({ total: 'pg/int8@1' })
      .build();
    let total = 0;
    for await (const row of db.runtime().query(countPlan)) {
      total = Number(row.total);
    }

    const pagePlan = db.raw.sql`
        SELECT
          dp.id,
          dp.full_name,
          dp.verification_status,
          dp.created_at,
          (
            (${b.matchUuid} = 1 AND dp.id = ${b.uuid}::uuid)
            OR (${b.matchPhone} = 1 AND a.phone = ${b.phoneE164})
          ) AS exact_match
        FROM driver_profiles dp
        INNER JOIN accounts a ON a.id = dp.account_id
        WHERE (
          (${b.matchUuid} = 1 AND dp.id = ${b.uuid}::uuid)
          OR dp.full_name ILIKE ${b.like}
          OR (${b.matchPhone} = 1 AND a.phone = ${b.phoneE164})
          OR (
            ${b.matchDigits} = 1
            AND a.phone IS NOT NULL
            AND regexp_replace(a.phone, '\\D', '', 'g') LIKE ${b.phoneDigitsLike}
          )
        )
        ORDER BY exact_match DESC, dp.created_at DESC, dp.id DESC
        LIMIT ${limit}
      `
      .returnsRow({
        id: 'pg/uuid@1',
        full_name: 'sql/varchar@1',
        verification_status: 'sql/varchar@1',
        created_at: 'pg/timestamptz-string@1',
        exact_match: 'pg/bool@1',
      })
      .build();

    const items: AdminSearchDriverHit[] = [];
    for await (const row of db.runtime().query(pagePlan)) {
      items.push({
        id: row.id,
        fullName: row.full_name,
        verificationStatus: row.verification_status,
        createdAt: row.created_at,
        exactMatch: Boolean(row.exact_match),
      });
    }
    return { type: 'drivers', total, limit, items };
  }

  async searchOrders(
    needle: Needle,
    limit: number,
  ): Promise<AdminSearchGroupPage<AdminSearchOrderHit>> {
    const db = this.db();
    const b = bound(needle);
    const countPlan = db.raw.sql`
        SELECT COUNT(*)::int8 AS total
        FROM orders o
        WHERE (
          (${b.matchUuid} = 1 AND o.id = ${b.uuid}::uuid)
          OR lower(o.public_reference) = lower(${b.text})
          OR o.public_reference ILIKE ${b.like}
        )
      `
      .returnsRow({ total: 'pg/int8@1' })
      .build();
    let total = 0;
    for await (const row of db.runtime().query(countPlan)) {
      total = Number(row.total);
    }

    const pagePlan = db.raw.sql`
        SELECT
          o.id,
          o.public_reference,
          o.status,
          o.fulfillment_status,
          o.created_at,
          cp.full_name AS customer_full_name,
          m.name AS merchant_name,
          (
            (${b.matchUuid} = 1 AND o.id = ${b.uuid}::uuid)
            OR lower(o.public_reference) = lower(${b.text})
          ) AS exact_match
        FROM orders o
        LEFT JOIN customer_profiles cp ON cp.id = o.customer_id
        LEFT JOIN merchant_branches mb ON mb.id = o.merchant_branch_id
        LEFT JOIN merchants m ON m.id = mb.merchant_id
        WHERE (
          (${b.matchUuid} = 1 AND o.id = ${b.uuid}::uuid)
          OR lower(o.public_reference) = lower(${b.text})
          OR o.public_reference ILIKE ${b.like}
        )
        ORDER BY exact_match DESC, o.created_at DESC, o.id DESC
        LIMIT ${limit}
      `
      .returnsRow({
        id: 'pg/uuid@1',
        public_reference: 'sql/varchar@1',
        status: 'sql/varchar@1',
        fulfillment_status: 'sql/varchar@1',
        created_at: 'pg/timestamptz-string@1',
        customer_full_name: { codecId: 'sql/varchar@1', nullable: true },
        merchant_name: { codecId: 'sql/varchar@1', nullable: true },
        exact_match: 'pg/bool@1',
      })
      .build();

    const items: AdminSearchOrderHit[] = [];
    for await (const row of db.runtime().query(pagePlan)) {
      items.push({
        id: row.id,
        publicReference: row.public_reference,
        status: row.status,
        fulfillmentStatus: row.fulfillment_status,
        customerFullName: row.customer_full_name,
        merchantName: row.merchant_name,
        createdAt: row.created_at,
        exactMatch: Boolean(row.exact_match),
      });
    }
    return { type: 'orders', total, limit, items };
  }

  async searchSupport(
    needle: Needle,
    limit: number,
  ): Promise<AdminSearchGroupPage<AdminSearchSupportHit>> {
    const db = this.db();
    const b = bound(needle);
    const countPlan = db.raw.sql`
        SELECT COUNT(*)::int8 AS total
        FROM support_tickets t
        WHERE (
          (${b.matchUuid} = 1 AND t.id = ${b.uuid}::uuid)
          OR lower(t.public_reference) = lower(${b.text})
          OR t.public_reference ILIKE ${b.like}
          OR (t.subject IS NOT NULL AND t.subject ILIKE ${b.like})
        )
      `
      .returnsRow({ total: 'pg/int8@1' })
      .build();
    let total = 0;
    for await (const row of db.runtime().query(countPlan)) {
      total = Number(row.total);
    }

    const pagePlan = db.raw.sql`
        SELECT
          t.id,
          t.public_reference,
          t.subject,
          t.status,
          t.priority,
          t.created_at,
          (
            (${b.matchUuid} = 1 AND t.id = ${b.uuid}::uuid)
            OR lower(t.public_reference) = lower(${b.text})
          ) AS exact_match
        FROM support_tickets t
        WHERE (
          (${b.matchUuid} = 1 AND t.id = ${b.uuid}::uuid)
          OR lower(t.public_reference) = lower(${b.text})
          OR t.public_reference ILIKE ${b.like}
          OR (t.subject IS NOT NULL AND t.subject ILIKE ${b.like})
        )
        ORDER BY exact_match DESC, t.created_at DESC, t.id DESC
        LIMIT ${limit}
      `
      .returnsRow({
        id: 'pg/uuid@1',
        public_reference: 'sql/varchar@1',
        subject: { codecId: 'sql/varchar@1', nullable: true },
        status: 'sql/varchar@1',
        priority: 'sql/varchar@1',
        created_at: 'pg/timestamptz-string@1',
        exact_match: 'pg/bool@1',
      })
      .build();

    const items: AdminSearchSupportHit[] = [];
    for await (const row of db.runtime().query(pagePlan)) {
      items.push({
        id: row.id,
        publicReference: row.public_reference,
        subject: row.subject,
        status: row.status,
        priority: row.priority,
        createdAt: row.created_at,
        exactMatch: Boolean(row.exact_match),
      });
    }
    return { type: 'support', total, limit, items };
  }
}
