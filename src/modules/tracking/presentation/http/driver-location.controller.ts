import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { CurrentPrincipal } from '../../../auth/presentation/http/decorators/current-principal.decorator';
import { TrackingService } from '../../application/tracking.service';
import { DriverLocationUpdateDto } from './dto/tracking-response.dto';

@ApiTags('driver-tracking')
@ApiBearerAuth()
@Controller('driver/location')
export class DriverLocationController {
  constructor(private readonly tracking: TrackingService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Publish the authenticated Driver current location',
    description:
      'Preferred transport is Socket.IO driver:location:update. This HTTP endpoint is a narrow authenticated fallback for mobile/background/reconnect. Same DriverLocationStore, validation, server timestamp, rate limit, and publish eligibility as the socket event. Does not change availability or Delivery status.',
  })
  publish(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: DriverLocationUpdateDto,
  ) {
    return this.tracking.publishDriverLocation(principal.accountId, body);
  }
}
