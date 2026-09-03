import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { CurrentPrincipal } from '../../../auth/presentation/http/decorators/current-principal.decorator';
import { DriverDeliveryService } from '../../application/driver-delivery.service';
import {
  DRIVER_DELIVERY_ACTION_ARRIVE_CUSTOMER,
  DRIVER_DELIVERY_ACTION_ARRIVE_PICKUP,
  DRIVER_DELIVERY_ACTION_COMPLETE_DELIVERY,
  DRIVER_DELIVERY_ACTION_CONFIRM_PICKUP,
  DRIVER_DELIVERY_ACTION_START_DELIVERY,
  DRIVER_DELIVERY_ACTION_START_TO_PICKUP,
} from '../../domain/driver-delivery.policy';
import {
  CurrentDriverDeliveryResponseDto,
  DriverCurrentDeliveryResponseDto,
} from './dto/driver-delivery-response.dto';

@ApiTags('driver-delivery')
@ApiBearerAuth()
@Controller('driver/deliveries/current')
export class DriverDeliveryController {
  constructor(private readonly workflow: DriverDeliveryService) {}

  @Get()
  @ApiOperation({
    summary: 'Read the authenticated Driver current accepted Delivery',
    description:
      'Own ACCEPTED unreleased assignment only. Pickup is live MerchantBranch without phone. Dropoff is the Order address snapshot. No Customer OTP/auth identity. allowedActions are derived, not persisted.',
  })
  @ApiOkResponse({ type: CurrentDriverDeliveryResponseDto })
  async getCurrent(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return { delivery: await this.workflow.getCurrent(principal.accountId) };
  }

  @Post('start-to-pickup')
  @HttpCode(200)
  @ApiOperation({ summary: 'DRIVER_ASSIGNED → TO_PICKUP' })
  @ApiOkResponse({ type: DriverCurrentDeliveryResponseDto })
  startToPickup(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.workflow.performAction(
      principal.accountId,
      DRIVER_DELIVERY_ACTION_START_TO_PICKUP,
    );
  }

  @Post('arrive-pickup')
  @HttpCode(200)
  @ApiOperation({
    summary: 'TO_PICKUP → AT_PICKUP',
    description:
      'Requires a fresh DriverLocationStore point (<=45s) within 300m of live MerchantBranch. GPS never auto-transitions Delivery.',
  })
  @ApiOkResponse({ type: DriverCurrentDeliveryResponseDto })
  arrivePickup(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.workflow.performAction(
      principal.accountId,
      DRIVER_DELIVERY_ACTION_ARRIVE_PICKUP,
    );
  }

  @Post('confirm-pickup')
  @HttpCode(200)
  @ApiOperation({
    summary: 'AT_PICKUP → PICKED_UP',
    description:
      'Driver-declared Merchant handoff. Merchant confirmation is not required. Sets pickedUpAt. No second GPS gate.',
  })
  @ApiOkResponse({ type: DriverCurrentDeliveryResponseDto })
  confirmPickup(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.workflow.performAction(
      principal.accountId,
      DRIVER_DELIVERY_ACTION_CONFIRM_PICKUP,
    );
  }

  @Post('start-delivery')
  @HttpCode(200)
  @ApiOperation({ summary: 'PICKED_UP → IN_TRANSIT' })
  @ApiOkResponse({ type: DriverCurrentDeliveryResponseDto })
  startDelivery(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.workflow.performAction(
      principal.accountId,
      DRIVER_DELIVERY_ACTION_START_DELIVERY,
    );
  }

  @Post('arrive-customer')
  @HttpCode(200)
  @ApiOperation({
    summary: 'IN_TRANSIT → ARRIVED_CUSTOMER',
    description:
      'Requires a fresh DriverLocationStore point (<=45s) within 300m of OrderDeliveryAddressSnapshot. Never uses live Customer Address. Sets arrivedCustomerAt.',
  })
  @ApiOkResponse({ type: DriverCurrentDeliveryResponseDto })
  arriveCustomer(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.workflow.performAction(
      principal.accountId,
      DRIVER_DELIVERY_ACTION_ARRIVE_CUSTOMER,
    );
  }

  @Post('complete-delivery')
  @HttpCode(200)
  @ApiOperation({
    summary: 'ARRIVED_CUSTOMER → DELIVERED when completion is eligible',
    description:
      'COD requires Payment SUCCEEDED plus CodCollection COLLECTED (exact amount match). ELECTRONIC requires SUCCEEDED Payment. Proofless MVP: no DeliveryProof. No DriverEarning. Releases the assignment. Fulfillment stays READY.',
  })
  @ApiOkResponse({ type: DriverCurrentDeliveryResponseDto })
  completeDelivery(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.workflow.performAction(
      principal.accountId,
      DRIVER_DELIVERY_ACTION_COMPLETE_DELIVERY,
    );
  }
}
