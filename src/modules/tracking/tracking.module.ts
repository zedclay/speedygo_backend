import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { DriversModule } from '../drivers/drivers.module';
import { MatchingModule } from '../matching/matching.module';
import { TrackingService } from './application/tracking.service';
import { TrackingCleanupService } from './infrastructure/tracking-cleanup.service';
import { TrackingGateway } from './infrastructure/tracking.gateway';
import { CustomerTrackingController } from './presentation/http/customer-tracking.controller';
import { DriverLocationController } from './presentation/http/driver-location.controller';
import { MerchantTrackingController } from './presentation/http/merchant-tracking.controller';

@Module({
  imports: [AuthModule, DeliveryModule, DriversModule, MatchingModule],
  controllers: [
    DriverLocationController,
    CustomerTrackingController,
    MerchantTrackingController,
  ],
  providers: [TrackingService, TrackingGateway, TrackingCleanupService],
  exports: [TrackingService, TrackingGateway],
})
export class TrackingModule {}
