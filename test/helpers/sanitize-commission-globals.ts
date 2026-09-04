import type { PrismaService } from '../../src/infrastructure/database/database.module';
import { pgNow } from '../../src/infrastructure/database/pg-values';

/**
 * Close all open GLOBAL_DEFAULT commission rules so a fixture can seed one
 * without "Multiple applicable global commission defaults".
 */
export async function deactivateOpenGlobalCommissionDefaults(
  prisma: PrismaService,
): Promise<void> {
  const rules = await prisma.getDb().orm.public.MerchantCommissionRule.all();
  const now = pgNow();
  for (const rule of rules) {
    if (rule.scope !== 'GLOBAL_DEFAULT' || rule.active !== true) {
      continue;
    }
    const open =
      rule.effectiveTo === null ||
      rule.effectiveTo === undefined ||
      String(rule.effectiveTo) > new Date().toISOString();
    if (!open && rule.effectiveTo != null) {
      // Still deactivate leftovers marked active with closed window.
    }
    await prisma
      .getDb()
      .orm.public.MerchantCommissionRule.where({ id: rule.id })
      .update({
        active: false,
        effectiveTo: now,
      });
  }
}
