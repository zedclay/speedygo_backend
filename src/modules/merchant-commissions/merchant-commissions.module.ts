import { Module } from '@nestjs/common';
import {
  CHECKOUT_CLOCK,
  SystemCheckoutClock,
} from '../checkout/domain/checkout.clock';
import { MerchantsModule } from '../merchants/merchants.module';
import { MerchantCommissionService } from './application/merchant-commission.service';
import { MerchantCommissionRepository } from './infrastructure/merchant-commission.repository';
import { MerchantCommissionController } from './presentation/http/merchant-commission.controller';

@Module({
  imports: [MerchantsModule],
  controllers: [MerchantCommissionController],
  providers: [
    MerchantCommissionRepository,
    MerchantCommissionService,
    { provide: CHECKOUT_CLOCK, useClass: SystemCheckoutClock },
  ],
  exports: [MerchantCommissionService],
})
export class MerchantCommissionsModule {}
