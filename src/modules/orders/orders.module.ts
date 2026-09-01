import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import {
  CHECKOUT_CLOCK,
  SystemCheckoutClock,
} from '../checkout/domain/checkout.clock';
import { OrderService } from './application/order.service';
import { OrderRepository } from './infrastructure/order.repository';
import { OrderController } from './presentation/http/order.controller';

@Module({
  imports: [CartModule],
  controllers: [OrderController],
  providers: [
    OrderRepository,
    OrderService,
    { provide: CHECKOUT_CLOCK, useClass: SystemCheckoutClock },
  ],
})
export class OrdersModule {}
