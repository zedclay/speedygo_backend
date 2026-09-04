import { Module } from '@nestjs/common';
import { DriversModule } from '../drivers/drivers.module';
import { FinancialLedgerModule } from '../financial-ledger/financial-ledger.module';
import { DriverRemunerationService } from './application/driver-remuneration.service';
import { DriverEarningRepository } from './infrastructure/driver-earning.repository';
import { DriverEarningController } from './presentation/http/driver-earning.controller';

@Module({
  imports: [DriversModule, FinancialLedgerModule],
  controllers: [DriverEarningController],
  providers: [DriverEarningRepository, DriverRemunerationService],
  exports: [DriverRemunerationService],
})
export class DriverRemunerationModule {}
