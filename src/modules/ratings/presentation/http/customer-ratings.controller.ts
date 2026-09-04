import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { CurrentPrincipal } from '../../../auth/presentation/http/decorators/current-principal.decorator';
import { RatingsService } from '../../application/ratings.service';
import { CreateRatingDto } from './dto/ratings.dto';

@ApiTags('customer-ratings')
@ApiBearerAuth()
@Controller('customer')
export class CustomerRatingsController {
  constructor(private readonly ratings: RatingsService) {}

  @Post('orders/:orderId/ratings/merchant')
  @ApiOperation({
    summary: 'Rate Merchant for a completed Order',
    description:
      'Requires CustomerProfile. Merchant derived from Order branch. Order must be COMPLETED. Body: score 1..5, optional comment. Ignores merchantId/authorId/driverId.',
  })
  rateMerchant(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: CreateRatingDto,
  ) {
    return this.ratings.rateMerchant(
      principal.accountId,
      orderId,
      body.score,
      body.comment,
    );
  }

  @Post('orders/:orderId/ratings/driver')
  @ApiOperation({
    summary: 'Rate Driver for a completed Order',
    description:
      'Requires CustomerProfile. Driver derived from DELIVERED Delivery historical serving DriverAssignment (RELEASED after completion; never REJECTED/EXPIRED/OFFERED). Order must be COMPLETED. Body: score 1..5, optional comment.',
  })
  rateDriver(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() body: CreateRatingDto,
  ) {
    return this.ratings.rateDriver(
      principal.accountId,
      orderId,
      body.score,
      body.comment,
    );
  }

  @Get('orders/:orderId/ratings/merchant')
  @ApiOperation({
    summary: 'Read own Merchant rating for Order',
    description: 'Author-only. Does not expose foreign ratings.',
  })
  getOwnMerchant(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.ratings.getOwnMerchantRating(principal.accountId, orderId);
  }

  @Get('orders/:orderId/ratings/driver')
  @ApiOperation({
    summary: 'Read own Driver rating for Order',
  })
  getOwnDriver(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.ratings.getOwnDriverRating(principal.accountId, orderId);
  }

  @Get('merchants/:merchantId/ratings/summary')
  @ApiOperation({
    summary: 'Merchant rating aggregate',
    description:
      'Authenticated. Returns count + average (null when count=0, two decimal places). No individual comments.',
  })
  merchantSummary(@Param('merchantId', ParseUUIDPipe) merchantId: string) {
    return this.ratings.merchantSummary(merchantId);
  }

  @Get('drivers/:driverId/ratings/summary')
  @ApiOperation({
    summary: 'Driver rating aggregate',
    description:
      'Authenticated. Returns count + average (null when count=0). No individual comments.',
  })
  driverSummary(@Param('driverId', ParseUUIDPipe) driverId: string) {
    return this.ratings.driverSummary(driverId);
  }
}
