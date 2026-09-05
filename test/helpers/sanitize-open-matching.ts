import type { PrismaService } from '../../src/infrastructure/database/database.module';
import { pgNow } from '../../src/infrastructure/database/pg-values';

/**
 * Clear open matching work left by earlier e2e files so Driver candidates are not
 * occupied by SEARCHING_DRIVER / open assignment orphans.
 */
export async function sanitizeOpenMatchingState(
  prisma: PrismaService,
): Promise<void> {
  const db = prisma.getDb().orm.public;
  const openDeliveries = await db.Delivery.where({
    status: 'SEARCHING_DRIVER',
  }).all();
  // Only clear SEARCHING_DRIVER work — do not mass-release open assignments
  // (that can disturb in-flight Driver workflow suites sharing the DB).
  for (const delivery of openDeliveries) {
    for (const row of await db.DriverAssignment.where({
      deliveryId: delivery.id,
    }).all()) {
      await db.DriverAssignment.where({ id: row.id }).delete();
    }
    for (const row of await db.DeliveryEvent.where({
      deliveryId: delivery.id,
    }).all()) {
      await db.DeliveryEvent.where({ id: row.id }).delete();
    }
    await db.Delivery.where({ id: delivery.id }).update({
      status: 'CANCELLED',
      updatedAt: pgNow(),
    });
  }
}
