import { createUuidV7 } from '../../src/common/utils/uuid-v7';
import { PrismaService } from '../../src/infrastructure/database/database.module';
import { pgNow } from '../../src/infrastructure/database/pg-values';
import { ISO_DAYS_OF_WEEK } from '../../src/modules/merchants/domain/opening-hours.constants';

/**
 * Deletes opening schedule + intervals for a branch (no-op when missing).
 * Call before MerchantBranch delete in e2e cleanup (FK RESTRICT).
 */
export async function deleteBranchOpeningHours(
  prisma: PrismaService,
  branchId: string,
): Promise<void> {
  const db = prisma.getDb().orm.public;
  const existing = await db.MerchantBranchOpeningSchedule.where({
    branchId,
  }).first();
  if (!existing) {
    return;
  }
  await db.MerchantBranchOpeningInterval.where({
    scheduleId: existing.id,
  }).delete();
  await db.MerchantBranchOpeningSchedule.where({ id: existing.id }).delete();
}

/**
 * Inserts a 24/7 Mon–Sun opening schedule for a branch (idempotent replace).
 * Use in e2e fixtures that create customer orders so checkout/order gates pass.
 */
export async function ensureBranchOpeningHours(
  prisma: PrismaService,
  branchId: string,
  updatedByAccountId: string,
): Promise<void> {
  await deleteBranchOpeningHours(prisma, branchId);

  const db = prisma.getDb().orm.public;
  const now = pgNow();
  const scheduleId = createUuidV7();
  await db.MerchantBranchOpeningSchedule.create({
    id: scheduleId,
    branchId,
    version: 1,
    updatedByAccountId,
    createdAt: now,
    updatedAt: now,
  });

  for (const dayOfWeek of ISO_DAYS_OF_WEEK) {
    await db.MerchantBranchOpeningInterval.create({
      id: createUuidV7(),
      scheduleId,
      dayOfWeek,
      opensMinute: 0,
      closesMinute: 0,
      closesNextDay: true,
      sortOrder: 0,
      createdAt: now,
    });
  }
}
