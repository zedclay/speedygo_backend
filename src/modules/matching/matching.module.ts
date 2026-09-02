import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { DeliveryModule } from '../delivery/delivery.module';
import { DriversModule } from '../drivers/drivers.module';
import { MatchingService } from './application/matching.service';
import { MATCHING_JOBS, MATCHING_QUEUE_NAME } from './domain/matching.jobs';
import { DRIVER_LOCATION_STORE } from './domain/matching.types';
import { AssignmentRepository } from './infrastructure/assignment.repository';
import { MatchingQueueService } from './infrastructure/matching-queue.service';
import { MatchingRecoveryService } from './infrastructure/matching-recovery.service';
import { MatchingProcessor } from './infrastructure/matching.processor';
import { RedisDriverLocationStore } from './infrastructure/redis-driver-location.store';
import { DriverAssignmentController } from './presentation/http/driver-assignment.controller';

@Module({
  imports: [
    DeliveryModule,
    DriversModule,
    BullModule.registerQueue({ name: MATCHING_QUEUE_NAME }),
  ],
  controllers: [DriverAssignmentController],
  providers: [
    AssignmentRepository,
    RedisDriverLocationStore,
    { provide: DRIVER_LOCATION_STORE, useExisting: RedisDriverLocationStore },
    MatchingQueueService,
    { provide: MATCHING_JOBS, useExisting: MatchingQueueService },
    MatchingService,
    MatchingRecoveryService,
    MatchingProcessor,
  ],
  exports: [
    MatchingService,
    MATCHING_JOBS,
    DRIVER_LOCATION_STORE,
    RedisDriverLocationStore,
    MatchingRecoveryService,
    MatchingProcessor,
  ],
})
export class MatchingModule {}
