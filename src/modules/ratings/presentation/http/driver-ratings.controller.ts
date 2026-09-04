import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { CurrentPrincipal } from '../../../auth/presentation/http/decorators/current-principal.decorator';
import { RatingsService } from '../../application/ratings.service';

@ApiTags('driver-ratings')
@ApiBearerAuth()
@Controller('driver/ratings')
export class DriverRatingsController {
  constructor(private readonly ratings: RatingsService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Driver own rating aggregate',
    description:
      'Requires DriverProfile. Returns count/average for self. No individual comments.',
  })
  summary(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.ratings.ownDriverSummary(principal.accountId);
  }
}
