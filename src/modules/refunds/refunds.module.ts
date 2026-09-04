import { Module } from '@nestjs/common';
import { FinancialLedgerModule } from '../financial-ledger/financial-ledger.module';
import { RefundService } from './application/refund.service';
import { REFUND_EXECUTOR } from './domain/refund.types';
import { RefundRepository } from './infrastructure/refund.repository';
import { UnsupportedProviderRefundExecutor } from './infrastructure/unsupported-provider-refund.executor';
import { CustomerRefundController } from './presentation/http/customer-refund.controller';

@Module({
  imports: [FinancialLedgerModule],
  controllers: [CustomerRefundController],
  providers: [
    RefundRepository,
    RefundService,
    {
      provide: REFUND_EXECUTOR,
      useClass: UnsupportedProviderRefundExecutor,
    },
  ],
  exports: [RefundService],
})
export class RefundsModule {}
