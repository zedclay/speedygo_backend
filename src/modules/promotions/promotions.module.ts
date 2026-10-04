import { Module } from '@nestjs/common';
import { PromotionService } from './application/promotion.service';
import { PromotionRepository } from './infrastructure/promotion.repository';
import { CustomerPromotionController } from './presentation/http/customer-promotion.controller';

@Module({
  controllers: [CustomerPromotionController],
  providers: [PromotionRepository, PromotionService],
  exports: [PromotionService],
})
export class PromotionsModule {}
