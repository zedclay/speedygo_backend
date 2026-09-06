import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { CheckoutService } from './application/checkout.service';
import { CHECKOUT_CLOCK, SystemCheckoutClock } from './domain/checkout.clock';
import { CheckoutRepository } from './infrastructure/checkout.repository';
import { CheckoutController } from './presentation/http/checkout.controller';

@Module({
  imports: [CartModule, PromotionsModule, MerchantsModule],
  controllers: [CheckoutController],
  providers: [
    CheckoutRepository,
    CheckoutService,
    { provide: CHECKOUT_CLOCK, useClass: SystemCheckoutClock },
  ],
})
export class CheckoutModule {}
