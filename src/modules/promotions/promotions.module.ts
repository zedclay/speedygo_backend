import { Module } from '@nestjs/common';
import { PromotionService } from './application/promotion.service';
import { PromotionRepository } from './infrastructure/promotion.repository';

@Module({
  providers: [PromotionRepository, PromotionService],
  exports: [PromotionService],
})
export class PromotionsModule {}
