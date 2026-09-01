import { Module } from '@nestjs/common';
import { CartService } from './application/cart.service';
import { CartRepository } from './infrastructure/cart.repository';
import { CartController } from './presentation/http/cart.controller';

@Module({
  controllers: [CartController],
  providers: [CartRepository, CartService],
  exports: [CartService],
})
export class CartModule {}
