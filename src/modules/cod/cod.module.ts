import { Module } from '@nestjs/common';
import { CodFoundationService } from './application/cod-foundation.service';
import { CodCollectionRepository } from './infrastructure/cod-collection.repository';
import { DriverCodCollectionController } from './presentation/http/driver-cod-collection.controller';
import { DriverCodRemittanceController } from './presentation/http/driver-cod-remittance.controller';
import { DriversModule } from '../drivers/drivers.module';

@Module({
  imports: [DriversModule],
  controllers: [DriverCodCollectionController, DriverCodRemittanceController],
  providers: [CodFoundationService, CodCollectionRepository],
  exports: [CodCollectionRepository, CodFoundationService],
})
export class CodModule {}
