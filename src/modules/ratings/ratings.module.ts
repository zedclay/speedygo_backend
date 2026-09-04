import { Module } from '@nestjs/common';
import { MerchantsModule } from '../merchants/merchants.module';
import { RatingsService } from './application/ratings.service';
import { RatingsRepository } from './infrastructure/ratings.repository';
import { CustomerRatingsController } from './presentation/http/customer-ratings.controller';
import { DriverRatingsController } from './presentation/http/driver-ratings.controller';
import { MerchantRatingsController } from './presentation/http/merchant-ratings.controller';

@Module({
  imports: [MerchantsModule],
  controllers: [
    CustomerRatingsController,
    MerchantRatingsController,
    DriverRatingsController,
  ],
  providers: [RatingsRepository, RatingsService],
  exports: [RatingsService],
})
export class RatingsModule {}
