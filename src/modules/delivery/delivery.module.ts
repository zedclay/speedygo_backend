import { Module, forwardRef } from '@nestjs/common';
import { DriversModule } from '../drivers/drivers.module';
import { MatchingModule } from '../matching/matching.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { DeliveryService } from './application/delivery.service';
import { DriverDeliveryService } from './application/driver-delivery.service';
import { DeliveryRepository } from './infrastructure/delivery.repository';
import { CodModule } from '../cod/cod.module';
import { DriverRemunerationModule } from '../driver-remuneration/driver-remuneration.module';
import { CustomerDeliveryController } from './presentation/http/customer-delivery.controller';
import { DriverDeliveryController } from './presentation/http/driver-delivery.controller';
import { MerchantDeliveryController } from './presentation/http/merchant-delivery.controller';

@Module({
  imports: [
    MerchantsModule,
    DriversModule,
    forwardRef(() => MatchingModule),
    CodModule,
    DriverRemunerationModule,
  ],
  controllers: [
    CustomerDeliveryController,
    MerchantDeliveryController,
    DriverDeliveryController,
  ],
  providers: [DeliveryRepository, DeliveryService, DriverDeliveryService],
  exports: [DeliveryService, DeliveryRepository, DriverDeliveryService],
})
export class DeliveryModule {}
