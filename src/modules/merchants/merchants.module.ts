import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GeoModule } from '../geo/geo.module';
import { MerchantAccessService } from './application/merchant-access.service';
import { MerchantBranchCoverService } from './application/merchant-branch-cover.service';
import { MerchantBranchLogoService } from './application/merchant-branch-logo.service';
import { MerchantBranchService } from './application/merchant-branch.service';
import { MerchantProfileService } from './application/merchant-profile.service';
import { MerchantTeamService } from './application/merchant-team.service';
import { MerchantReviewService } from './application/merchant-review.service';
import { MerchantVerificationService } from './application/merchant-verification.service';
import { OpeningHoursService } from './application/opening-hours.service';
import { OpeningHoursExceptionService } from './application/opening-hours-exception.service';
import { BranchAvailabilityService } from './application/branch-availability.service';
import { MerchantBranchCoverRepository } from './infrastructure/merchant-branch-cover.repository';
import { MerchantBranchLogoRepository } from './infrastructure/merchant-branch-logo.repository';
import { MerchantRepository } from './infrastructure/merchant.repository';
import { MerchantTeamRepository } from './infrastructure/merchant-team.repository';
import { OpeningHoursRepository } from './infrastructure/opening-hours.repository';
import { OpeningHoursExceptionRepository } from './infrastructure/opening-hours-exception.repository';
import { BranchAvailabilityRepository } from './infrastructure/branch-availability.repository';
import { MerchantController } from './presentation/http/merchant.controller';
import { MerchantTeamController } from './presentation/http/merchant-team.controller';

@Module({
  imports: [AuthModule, GeoModule],
  controllers: [MerchantController, MerchantTeamController],
  providers: [
    MerchantRepository,
    MerchantTeamRepository,
    MerchantBranchCoverRepository,
    MerchantBranchLogoRepository,
    OpeningHoursRepository,
    OpeningHoursExceptionRepository,
    BranchAvailabilityRepository,
    MerchantAccessService,
    MerchantProfileService,
    MerchantBranchService,
    OpeningHoursService,
    OpeningHoursExceptionService,
    BranchAvailabilityService,
    MerchantVerificationService,
    MerchantReviewService,
    MerchantBranchCoverService,
    MerchantBranchLogoService,
    MerchantTeamService,
  ],
  exports: [
    MerchantRepository,
    MerchantBranchCoverRepository,
    MerchantBranchCoverService,
    MerchantAccessService,
    MerchantReviewService,
    MerchantVerificationService,
    OpeningHoursService,
    BranchAvailabilityService,
  ],
})
export class MerchantsModule {}
