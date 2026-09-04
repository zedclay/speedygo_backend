import { Module } from '@nestjs/common';
import { FinancialLedgerService } from './application/financial-ledger.service';
import { FinancialLedgerRepository } from './infrastructure/financial-ledger.repository';

@Module({
  providers: [FinancialLedgerRepository, FinancialLedgerService],
  exports: [FinancialLedgerService],
})
export class FinancialLedgerModule {}
