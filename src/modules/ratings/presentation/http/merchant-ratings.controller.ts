import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { CurrentPrincipal } from '../../../auth/presentation/http/decorators/current-principal.decorator';
import { MerchantAccessService } from '../../../merchants/application/merchant-access.service';
import { RatingsService } from '../../application/ratings.service';

@ApiTags('merchant-ratings')
@ApiBearerAuth()
@Controller('merchant/:merchantId/ratings')
export class MerchantRatingsController {
  constructor(
    private readonly ratings: RatingsService,
    private readonly merchantAccess: MerchantAccessService,
  ) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Merchant own rating aggregate',
    description:
      'Any current Merchant member may read count/average for their Merchant. No individual comments.',
  })
  async summary(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
  ) {
    await this.merchantAccess.requireMembership(
      principal.accountId,
      merchantId,
    );
    return this.ratings.merchantSummary(merchantId);
  }
}
