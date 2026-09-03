import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import {
  CHECKOUT_CLOCK,
  SystemCheckoutClock,
} from '../checkout/domain/checkout.clock';
import { MatchingModule } from '../matching/matching.module';
import { MerchantCommissionsModule } from '../merchant-commissions/merchant-commissions.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { MerchantOrderService } from './application/merchant-order.service';
import { OrderService } from './application/order.service';
import { OrderRepository } from './infrastructure/order.repository';
import { MerchantOrderController } from './presentation/http/merchant-order.controller';
import { OrderController } from './presentation/http/order.controller';

@Module({
  imports: [
    CartModule,
    MatchingModule,
    MerchantsModule,
    MerchantCommissionsModule,
  ],
  controllers: [OrderController, MerchantOrderController],
  providers: [
    OrderRepository,
    OrderService,
    MerchantOrderService,
    { provide: CHECKOUT_CLOCK, useClass: SystemCheckoutClock },
  ],
})
export class OrdersModule {}
