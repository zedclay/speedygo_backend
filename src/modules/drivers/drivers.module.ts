import { Module } from '@nestjs/common';
import { DriverReviewService } from './application/driver-review.service';
import { DriverService } from './application/driver.service';
import { DriverRepository } from './infrastructure/driver.repository';
import { DriverController } from './presentation/http/driver.controller';

@Module({
  controllers: [DriverController],
  providers: [DriverRepository, DriverService, DriverReviewService],
  exports: [DriverService, DriverReviewService],
})
export class DriversModule {}
