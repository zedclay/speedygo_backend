import { PrismaService } from '../../src/infrastructure/database/database.module';
import { pgNow } from '../../src/infrastructure/database/pg-values';

/**
 * Deactivates every delivery zone so a leftover overlapping active zone
 * cannot 409 subsequent checkout/e2e suites.
 */
export async function deactivateAllDeliveryZones(
  prisma: PrismaService,
): Promise<void> {
  const db = prisma.getDb().orm.public;
  const now = pgNow();
  for (const zone of await db.DeliveryZone.where({ active: true }).all()) {
    await db.DeliveryZone.where({ id: zone.id }).update({
      active: false,
      updatedAt: now,
    });
  }
}
