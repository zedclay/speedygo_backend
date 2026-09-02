import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { CurrentPrincipal } from '../../../auth/presentation/http/decorators/current-principal.decorator';
import { TrackingService } from '../../application/tracking.service';
import { TrackingSnapshotDto } from './dto/tracking-response.dto';

@ApiTags('merchant-tracking')
@ApiBearerAuth()
@Controller('merchant/:merchantId/orders/:orderId/tracking')
export class MerchantTrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Get()
  @ApiOperation({
    summary: 'Latest authorized tracking snapshot for a Merchant-owned Order',
    description:
      'Requires ORDER_READ (same as Merchant Delivery GET, including STAFF). Foreign Merchant Orders return MERCHANT_ORDER_NOT_FOUND. No candidate/OFFERED Driver location.',
  })
  @ApiOkResponse({ type: TrackingSnapshotDto })
  get(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.tracking.snapshotForMerchant(
      principal.accountId,
      merchantId,
      orderId,
    );
  }
}
