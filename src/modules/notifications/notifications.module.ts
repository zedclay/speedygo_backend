import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { NotificationRecoveryService } from './application/notification-recovery.service';
import { NotificationService } from './application/notification.service';
import {
  NOTIFICATION_JOBS,
  NOTIFICATION_QUEUE_NAME,
} from './domain/notification.jobs';
import { NotificationQueueService } from './infrastructure/notification-queue.service';
import { NotificationRecoveryRepository } from './infrastructure/notification-recovery.repository';
import { NotificationRepository } from './infrastructure/notification.repository';
import { NotificationProcessor } from './infrastructure/notification.processor';
import { NotificationController } from './presentation/http/notification.controller';

@Module({
  imports: [BullModule.registerQueue({ name: NOTIFICATION_QUEUE_NAME })],
  controllers: [NotificationController],
  providers: [
    NotificationRepository,
    NotificationService,
    NotificationRecoveryRepository,
    NotificationRecoveryService,
    NotificationQueueService,
    { provide: NOTIFICATION_JOBS, useExisting: NotificationQueueService },
    NotificationProcessor,
  ],
  exports: [NotificationService, NotificationRecoveryService],
})
export class NotificationsModule {}
