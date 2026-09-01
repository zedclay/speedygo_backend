import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import {
  CHECKOUT_CLOCK,
  SystemCheckoutClock,
} from '../checkout/domain/checkout.clock';
import { MerchantsModule } from '../merchants/merchants.module';
import { MerchantOrderService } from './application/merchant-order.service';
import { OrderService } from './application/order.service';
import { OrderRepository } from './infrastructure/order.repository';
import { MerchantOrderController } from './presentation/http/merchant-order.controller';
import { OrderController } from './presentation/http/order.controller';

@Module({
  imports: [CartModule, MerchantsModule],
  controllers: [OrderController, MerchantOrderController],
  providers: [
    OrderRepository,
    OrderService,
    MerchantOrderService,
    { provide: CHECKOUT_CLOCK, useClass: SystemCheckoutClock },
  ],
})
export class OrdersModule {}
