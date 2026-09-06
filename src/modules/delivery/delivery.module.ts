import { Module, forwardRef } from '@nestjs/common';
import { DriversModule } from '../drivers/drivers.module';
import { MatchingModule } from '../matching/matching.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { DeliveryService } from './application/delivery.service';
import { DriverDeliveryService } from './application/driver-delivery.service';
import { DriverDeliveryHistoryService } from './application/driver-delivery-history.service';
import { DeliveryRepository } from './infrastructure/delivery.repository';
import { DriverDeliveryHistoryRepository } from './infrastructure/driver-delivery-history.repository';
import { CodModule } from '../cod/cod.module';
import { DriverRemunerationModule } from '../driver-remuneration/driver-remuneration.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CustomerDeliveryController } from './presentation/http/customer-delivery.controller';
import { DriverDeliveryController } from './presentation/http/driver-delivery.controller';
import { DriverDeliveryHistoryController } from './presentation/http/driver-delivery-history.controller';
import { MerchantDeliveryController } from './presentation/http/merchant-delivery.controller';

@Module({
  imports: [
    MerchantsModule,
    DriversModule,
    forwardRef(() => MatchingModule),
    CodModule,
    DriverRemunerationModule,
    NotificationsModule,
  ],
  controllers: [
    CustomerDeliveryController,
    MerchantDeliveryController,
    DriverDeliveryController,
    DriverDeliveryHistoryController,
  ],
  providers: [
    DeliveryRepository,
    DeliveryService,
    DriverDeliveryService,
    DriverDeliveryHistoryRepository,
    DriverDeliveryHistoryService,
  ],
  exports: [
    DeliveryService,
    DeliveryRepository,
    DriverDeliveryService,
    DriverDeliveryHistoryService,
  ],
})
export class DeliveryModule {}
