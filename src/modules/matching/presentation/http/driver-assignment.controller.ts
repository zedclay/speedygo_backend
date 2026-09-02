import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { CurrentPrincipal } from '../../../auth/presentation/http/decorators/current-principal.decorator';
import { MatchingService } from '../../application/matching.service';
import { MATCHING_ERROR_CODES } from '../../domain/matching.errors';
import {
  AcceptedAssignmentResponseDto,
  CurrentAcceptedResponseDto,
  CurrentOfferResponseDto,
} from './dto/assignment-response.dto';

@ApiTags('driver-assignments')
@ApiBearerAuth()
@Controller('driver/assignments')
export class DriverAssignmentController {
  constructor(private readonly matching: MatchingService) {}

  @Get('current-offer')
  @ApiOperation({
    summary: 'Read the authenticated Driver current assignment offer',
    description: [
      'Returns the open OFFERED assignment for this Driver, or offer=null.',
      'Does not list SEARCHING_DRIVER Deliveries. Foreign offers are never returned.',
      'Offer DTO omits Customer contact, Merchant phone, exact dropoff address, commission, and SpeedyGo share.',
    ].join(' '),
  })
  @ApiOkResponse({ type: CurrentOfferResponseDto })
  async getCurrentOffer(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return { offer: await this.matching.getCurrentOffer(principal.accountId) };
  }

  @Get('current')
  @ApiOperation({
    summary: 'Read the authenticated Driver accepted assignment',
    description:
      'Returns the ACCEPTED assignment if one exists. Pickup has no Merchant phone. Dropoff is the Order snapshot, not Customer Account/OTP identity. Does not start pickup workflow.',
  })
  @ApiOkResponse({ type: CurrentAcceptedResponseDto })
  async getCurrent(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return {
      assignment: await this.matching.getAcceptedAssignment(
        principal.accountId,
      ),
    };
  }

  @Post(':assignmentId/accept')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Accept an assignment offer addressed to this Driver',
    description: [
      'Revalidates offer state, Delivery SEARCHING_DRIVER, operational readiness, and fresh location.',
      'Atomically sets Assignment ACCEPTED, Delivery DRIVER_ASSIGNED, and DeliveryEvent DRIVER_ASSIGNED.',
      'Order stays ACTIVE. Fulfillment stays READY. No TO_PICKUP, earnings, COD, or payment mutation.',
    ].join(' '),
  })
  @ApiOkResponse({ type: AcceptedAssignmentResponseDto })
  @ApiResponse({
    status: 409,
    description: [
      MATCHING_ERROR_CODES.DRIVER_ASSIGNMENT_INVALID_STATE,
      MATCHING_ERROR_CODES.DRIVER_ASSIGNMENT_EXPIRED,
      MATCHING_ERROR_CODES.DRIVER_NOT_MATCHING_ELIGIBLE,
    ].join(' or '),
  })
  accept(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
  ) {
    return this.matching.accept(principal.accountId, assignmentId);
  }

  @Post(':assignmentId/reject')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reject an assignment offer addressed to this Driver',
    description:
      'Marks the offer REJECTED and released. Delivery remains SEARCHING_DRIVER. Matching may offer the next eligible Driver.',
  })
  @ApiOkResponse({ description: 'Matching continuation result' })
  reject(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
  ) {
    return this.matching.reject(principal.accountId, assignmentId);
  }
}
