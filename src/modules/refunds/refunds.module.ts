import { Module } from '@nestjs/common';
import { RefundService } from './application/refund.service';
import { REFUND_EXECUTOR } from './domain/refund.types';
import { RefundRepository } from './infrastructure/refund.repository';
import { UnsupportedProviderRefundExecutor } from './infrastructure/unsupported-provider-refund.executor';
import { CustomerRefundController } from './presentation/http/customer-refund.controller';

@Module({
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
