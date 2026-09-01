import { Injectable } from '@nestjs/common';
import {
  PrismaService,
  type SpeedyGoDb,
} from '../../../infrastructure/database/database.module';
import { parseMinorUnits } from '../../catalog/domain/catalog.policy';
import type {
  CheckoutAddressRecord,
  CheckoutPricingRuleRecord,
  CheckoutZoneRecord,
} from '../domain/checkout.types';

type OrmClient = { orm: SpeedyGoDb['orm'] };

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
export class CheckoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(): SpeedyGoDb {
    return this.prisma.getDb();
  }

  async findProfileByAccountId(
    accountId: string,
  ): Promise<{ id: string; accountId: string } | null> {
    const row = await orm(this.db())
      .CustomerProfile.where({ accountId })
      .first();
    return row ? { id: row.id, accountId: row.accountId } : null;
  }

  async findOwnedAddress(
    customerId: string,
    addressId: string,
  ): Promise<CheckoutAddressRecord | null> {
    const row = await orm(this.db())
      .Address.where({ id: addressId, customerId })
      .first();
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      customerId: row.customerId,
      label: row.label,
      addressText: row.addressText,
      latitude: parseCoordinate(row.latitude),
      longitude: parseCoordinate(row.longitude),
    };
  }

  async findBranchMerchant(branchId: string): Promise<{
    merchantId: string;
    merchantStatus: string;
    merchantVerifiedAt: string | null;
    merchantName: string;
    branchOperationalStatus: string;
  } | null> {
    const branch = await orm(this.db())
      .MerchantBranch.where({ id: branchId })
      .first();
    if (!branch) {
      return null;
    }
    const merchant = await orm(this.db())
      .Merchant.where({ id: branch.merchantId })
      .first();
    if (!merchant) {
      return null;
    }
    return {
      merchantId: merchant.id,
      merchantStatus: merchant.status,
      merchantVerifiedAt: merchant.verifiedAt,
      merchantName: merchant.name,
      branchOperationalStatus: branch.operationalStatus,
    };
  }

  /**
   * Active DeliveryZones whose MultiPolygon ST_Covers the Address point.
   * Boundary points are inside. Zones are platform-wide (no Merchant/Branch FK).
   *
   * Point construction is lon/lat: ST_MakePoint(longitude, latitude).
   */
  async findCoveringZones(
    latitude: number,
    longitude: number,
  ): Promise<CheckoutZoneRecord[]> {
    const client = this.db();
    const plan = client.raw.sql`
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
    const rows = await client.runtime().query(plan);
    return rows.map((row) => ({ id: row.id, name: String(row.name) }));
  }

  async listActivePricingRules(
    zoneId: string,
  ): Promise<CheckoutPricingRuleRecord[]> {
    const rows = await orm(this.db())
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
}
