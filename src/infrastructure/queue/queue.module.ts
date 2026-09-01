import { Module } from '@nestjs/common';

/**
 * BullMQ queues will be registered per use-case (notifications, reconciliation, etc.).
 * Do not add queues until a job has an approved owner module.
 */
@Module({})
export class QueueModule {}
