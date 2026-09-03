import { Injectable } from '@nestjs/common';
import { createUuidV7 } from '../../../common/utils/uuid-v7';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import {
  pgBigInt,
  pgTimestamptz,
  pgVarchar,
} from '../../../infrastructure/database/pg-values';
import { parseMinorUnits } from '../../catalog/domain/catalog.policy';
import {
  DRIVER_EARNING_STATUS_EARNED,
  type DriverEarningRecord,
} from '../domain/driver-remuneration.types';

export type OrmClient = { orm: SpeedyGoDb['orm'] };

function orm(client: OrmClient) {
  return client.orm.public;
}

@Injectable()
export class DriverEarningRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async findByDeliveryId(
    deliveryId: string,
    client?: OrmClient,
  ): Promise<DriverEarningRecord | null> {
    const db = client ?? { orm: this.db().orm };
    const row = await orm(db).DriverEarning.where({ deliveryId }).first();
    return row ? toRecord(row) : null;
  }

  async findDriverRemunerationSnapshot(
    orderId: string,
    client?: OrmClient,
  ): Promise<{
    driverRemunerationMinor: number;
    customerDeliveryFeeMinor: number;
    speedyGoDeliveryShareMinor: number;
  } | null> {
    const db = client ?? { orm: this.db().orm };
    const row = await orm(db).OrderFinancialSnapshot.where({ orderId }).first();
    if (!row) {
      return null;
    }
    return {
      driverRemunerationMinor: parseMinorUnits(row.driverRemunerationMinor),
      customerDeliveryFeeMinor: parseMinorUnits(row.customerDeliveryFeeMinor),
      speedyGoDeliveryShareMinor: parseMinorUnits(
        row.speedyGoDeliveryShareMinor,
      ),
    };
  }

  async createEarned(
    input: {
      deliveryId: string;
      driverId: string;
      baseRemunerationMinor: number;
      bonusMinor: number;
      adjustmentMinor: number;
      netEarningMinor: number;
      validatedAt: string;
    },
    client?: OrmClient,
  ): Promise<DriverEarningRecord> {
    const db = client ?? { orm: this.db().orm };
    const id = createUuidV7();
    const at = pgTimestamptz(input.validatedAt);
    await orm(db).DriverEarning.create({
      id,
      deliveryId: input.deliveryId,
      driverId: input.driverId,
      baseRemunerationMinor: pgBigInt(input.baseRemunerationMinor),
      bonusMinor: pgBigInt(input.bonusMinor),
      adjustmentMinor: pgBigInt(input.adjustmentMinor),
      netEarningMinor: pgBigInt(input.netEarningMinor),
      status: pgVarchar<64>(DRIVER_EARNING_STATUS_EARNED),
      validatedAt: at,
      createdAt: at,
      updatedAt: at,
    });
    const row = await orm(db).DriverEarning.where({ id }).first();
    if (!row) {
      throw new Error('DriverEarning create did not persist');
    }
    return toRecord(row);
  }

  async aggregateDriverEarnings(driverId: string): Promise<{
    totalEarnedMinor: number;
    unpaidEarnedMinor: number;
    earningCount: number;
  }> {
    const plan = this.db().raw.sql`
        SELECT
          COALESCE(SUM(net_earning_minor), 0)::bigint AS total_earned_minor,
          COALESCE(
            SUM(net_earning_minor) FILTER (WHERE status = ${DRIVER_EARNING_STATUS_EARNED}),
            0
          )::bigint AS unpaid_earned_minor,
          COUNT(*)::int4 AS earning_count
        FROM driver_earnings
        WHERE driver_id = ${driverId}::uuid
      `
      .returnsRow({
        total_earned_minor: 'pg/int8@1',
        unpaid_earned_minor: 'pg/int8@1',
        earning_count: 'pg/int4@1',
      })
      .build();
    const rows: Array<{
      total_earned_minor: bigint | string | number;
      unpaid_earned_minor: bigint | string | number;
      earning_count: number;
    }> = [];
    for await (const row of this.db().runtime().query(plan)) {
      rows.push(row);
    }
    const row = rows[0];
    if (!row) {
      return {
        totalEarnedMinor: 0,
        unpaidEarnedMinor: 0,
        earningCount: 0,
      };
    }
    return {
      totalEarnedMinor: Number(row.total_earned_minor),
      unpaidEarnedMinor: Number(row.unpaid_earned_minor),
      earningCount: Number(row.earning_count),
    };
  }

  async listDriverEarnings(
    driverId: string,
    page: { limit: number; offset: number },
  ): Promise<{
    items: Array<DriverEarningRecord & { orderId: string }>;
    total: number;
  }> {
    const plan = this.db().raw.sql`
        SELECT
          e.id,
          e.delivery_id,
          e.driver_id,
          e.base_remuneration_minor,
          e.bonus_minor,
          e.adjustment_minor,
          e.net_earning_minor,
          e.status,
          e.validated_at,
          e.created_at,
          e.updated_at,
          d.order_id
        FROM driver_earnings e
        INNER JOIN deliveries d ON d.id = e.delivery_id
        WHERE e.driver_id = ${driverId}::uuid
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT ${page.limit}
        OFFSET ${page.offset}
      `
      .returnsRow({
        id: 'pg/uuid@1',
        delivery_id: 'pg/uuid@1',
        driver_id: 'pg/uuid@1',
        base_remuneration_minor: 'pg/int8@1',
        bonus_minor: 'pg/int8@1',
        adjustment_minor: 'pg/int8@1',
        net_earning_minor: 'pg/int8@1',
        status: 'sql/varchar@1',
        validated_at: { codecId: 'pg/timestamptz-string@1', nullable: true },
        created_at: 'pg/timestamptz-string@1',
        updated_at: 'pg/timestamptz-string@1',
        order_id: 'pg/uuid@1',
      })
      .build();
    const items: Array<DriverEarningRecord & { orderId: string }> = [];
    for await (const row of this.db().runtime().query(plan)) {
      items.push({
        id: String(row.id),
        deliveryId: String(row.delivery_id),
        driverId: String(row.driver_id),
        baseRemunerationMinor: Number(row.base_remuneration_minor),
        bonusMinor: Number(row.bonus_minor),
        adjustmentMinor: Number(row.adjustment_minor),
        netEarningMinor: Number(row.net_earning_minor),
        status: String(row.status),
        validatedAt: row.validated_at ? String(row.validated_at) : null,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        orderId: String(row.order_id),
      });
    }
    const countPlan = this.db().raw.sql`
        SELECT COUNT(*)::int4 AS total
        FROM driver_earnings
        WHERE driver_id = ${driverId}::uuid
      `
      .returnsRow({
        total: 'pg/int4@1',
      })
      .build();
    let total = 0;
    for await (const row of this.db().runtime().query(countPlan)) {
      total = Number(row.total);
    }
    return { items, total };
  }
}

function toRecord(row: {
  id: string;
  deliveryId: string;
  driverId: string;
  baseRemunerationMinor: bigint | string | number;
  bonusMinor: bigint | string | number;
  adjustmentMinor: bigint | string | number;
  netEarningMinor: bigint | string | number;
  status: string;
  validatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}): DriverEarningRecord {
  return {
    id: row.id,
    deliveryId: row.deliveryId,
    driverId: row.driverId,
    baseRemunerationMinor: parseMinorUnits(row.baseRemunerationMinor),
    bonusMinor: parseMinorUnits(row.bonusMinor),
    adjustmentMinor: parseMinorUnits(row.adjustmentMinor),
    netEarningMinor: parseMinorUnits(row.netEarningMinor),
    status: row.status,
    validatedAt: row.validatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
