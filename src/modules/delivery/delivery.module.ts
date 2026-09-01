import { Module } from '@nestjs/common';
import { MerchantsModule } from '../merchants/merchants.module';
import { DeliveryService } from './application/delivery.service';
import { DeliveryRepository } from './infrastructure/delivery.repository';
import { CustomerDeliveryController } from './presentation/http/customer-delivery.controller';
import { MerchantDeliveryController } from './presentation/http/merchant-delivery.controller';

@Module({
  imports: [MerchantsModule],
  controllers: [CustomerDeliveryController, MerchantDeliveryController],
  providers: [DeliveryRepository, DeliveryService],
  exports: [DeliveryService],
})
export class DeliveryModule {}
