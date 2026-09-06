import { Module } from '@nestjs/common';
import { MerchantAccessService } from './application/merchant-access.service';
import { MerchantBranchService } from './application/merchant-branch.service';
import { MerchantProfileService } from './application/merchant-profile.service';
import { MerchantReviewService } from './application/merchant-review.service';
import { MerchantVerificationService } from './application/merchant-verification.service';
import { OpeningHoursService } from './application/opening-hours.service';
import { MerchantRepository } from './infrastructure/merchant.repository';
import { OpeningHoursRepository } from './infrastructure/opening-hours.repository';
import { MerchantController } from './presentation/http/merchant.controller';

@Module({
  controllers: [MerchantController],
  providers: [
    MerchantRepository,
    OpeningHoursRepository,
    MerchantAccessService,
    MerchantProfileService,
    MerchantBranchService,
    OpeningHoursService,
    MerchantVerificationService,
    MerchantReviewService,
  ],
  exports: [
    MerchantRepository,
    MerchantAccessService,
    MerchantReviewService,
    MerchantVerificationService,
    OpeningHoursService,
  ],
})
export class MerchantsModule {}
