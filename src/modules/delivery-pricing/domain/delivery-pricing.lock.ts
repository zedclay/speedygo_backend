import { createHash } from 'node:crypto';

/** ASCII 'SGDZ' — SpeedyGo Delivery Zone topology advisory lock class. */
export const DELIVERY_ZONE_TOPOLOGY_LOCK_CLASS = 0x5347445a;

/** Global object id: one topology lock for all active-zone geometry mutations. */
export const DELIVERY_ZONE_TOPOLOGY_LOCK_OBJECT = 1;

/** ASCII 'SGDP' — SpeedyGo Delivery Pricing per-zone advisory lock class. */
export const DELIVERY_PRICING_ZONE_LOCK_CLASS = 0x53474450;

export function deliveryPricingZoneAdvisoryObjectId(zoneId: string): number {
  const digest = createHash('sha256')
    .update('speedygo.delivery_pricing.zone\0')
    .update(zoneId)
    .digest();
  const value = digest.readInt32BE(0);
  return value === 0 ? 1 : value;
}
