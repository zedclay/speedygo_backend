import type { PrismaService } from '../../src/infrastructure/database/database.module';

/**
 * Delete NotificationDeliveryLog + Notification + DeviceToken for an Account
 * before Account deletion (FK: notifications_account_id_fkey, device_tokens_account_id_fkey).
 */
export async function deleteAccountNotificationArtifacts(
  prisma: PrismaService,
  accountId: string,
): Promise<void> {
  const db = prisma.getDb().orm.public;
  const notifications = await db.Notification.where({ accountId }).all();
  for (const notification of notifications) {
    const logs = await db.NotificationDeliveryLog.where({
      notificationId: notification.id,
    }).all();
    for (const log of logs) {
      await db.NotificationDeliveryLog.where({ id: log.id }).delete();
    }
    await db.Notification.where({ id: notification.id }).delete();
  }
  const tokens = await db.DeviceToken.where({ accountId }).all();
  for (const token of tokens) {
    await db.DeviceToken.where({ id: token.id }).delete();
  }
}
