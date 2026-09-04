import { Module } from '@nestjs/common';
import { FinancialLedgerModule } from '../financial-ledger/financial-ledger.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { MerchantSettlementService } from './application/merchant-settlement.service';
import { MerchantSettlementRepository } from './infrastructure/merchant-settlement.repository';
import { MerchantSettlementController } from './presentation/http/merchant-settlement.controller';

@Module({
  imports: [MerchantsModule, FinancialLedgerModule],
  controllers: [MerchantSettlementController],
  providers: [MerchantSettlementRepository, MerchantSettlementService],
  exports: [MerchantSettlementService],
})
export class MerchantSettlementsModule {}
