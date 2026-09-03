import { Module } from '@nestjs/common';
import { DriversModule } from '../drivers/drivers.module';
import { DriverRemunerationService } from './application/driver-remuneration.service';
import { DriverEarningRepository } from './infrastructure/driver-earning.repository';
import { DriverEarningController } from './presentation/http/driver-earning.controller';

@Module({
  imports: [DriversModule],
  controllers: [DriverEarningController],
  providers: [DriverEarningRepository, DriverRemunerationService],
  exports: [DriverRemunerationService],
})
export class DriverRemunerationModule {}
