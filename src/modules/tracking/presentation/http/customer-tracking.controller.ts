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

@ApiTags('customer-tracking')
@ApiBearerAuth()
@Controller('customer/orders/:orderId/tracking')
export class CustomerTrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Get()
  @ApiOperation({
    summary: 'Latest authorized tracking snapshot for an owned Order',
    description:
      'Order-centric. Foreign Orders return ORDER_NOT_FOUND. No Driver location is returned until an ACCEPTED unreleased assignment exists. Stale coordinates are not returned as live.',
  })
  @ApiOkResponse({ type: TrackingSnapshotDto })
  get(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.tracking.snapshotForCustomer(principal.accountId, orderId);
  }
}
