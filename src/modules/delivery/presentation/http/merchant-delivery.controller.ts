import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { CurrentPrincipal } from '../../../auth/presentation/http/decorators/current-principal.decorator';
import { MERCHANT_ERROR_CODES } from '../../../merchants/domain/merchant.errors';
import { ORDER_ERROR_CODES } from '../../../orders/domain/order.errors';
import { DeliveryService } from '../../application/delivery.service';
import { PickupHandoffService } from '../../application/pickup-handoff.service';
import { DELIVERY_ERROR_CODES } from '../../domain/delivery.errors';
import { PICKUP_HANDOFF_ERROR_CODES } from '../../domain/pickup-handoff.errors';
import { MerchantDeliveryResponseDto } from './dto/delivery-response.dto';
import { MerchantPickupHandoffResponseDto } from './dto/pickup-handoff-response.dto';

@ApiTags('merchant-delivery')
@ApiBearerAuth()
@Controller('merchant/:merchantId/orders/:orderId/delivery')
export class MerchantDeliveryController {
  constructor(
    private readonly deliveries: DeliveryService,
    private readonly pickupHandoffs: PickupHandoffService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get Delivery for a Merchant-owned Order',
    description: [
      'merchantId is selection context only. Requires a live MerchantMember. STAFF may read. SUSPENDED Merchants may read.',
      'Foreign Merchant Orders return MERCHANT_ORDER_NOT_FOUND. Owned Order without Delivery returns DELIVERY_NOT_FOUND (expected until Driver Matching starts).',
      'Pickup is live MerchantBranch (including phone). Dropoff is the Order address snapshot. When an open ACCEPTED assignment exists, additive assignedDriver exposes displayName, ACTIVE vehicle type/plate, assignment identity/version, arrival event and persisted ETA only. Account.phone is never shared (callAllowed=false in v1). SEARCHING_DRIVER with assignedDriverId null is readable before Driver Assignment.',
      'Does not expose driver remuneration or SpeedyGo delivery share. No Merchant Delivery status mutation on this GET. No public Delivery create.',
    ].join(' '),
  })
  @ApiOkResponse({ type: MerchantDeliveryResponseDto })
  @ApiResponse({
    status: 404,
    description: [
      MERCHANT_ERROR_CODES.MERCHANT_NOT_FOUND,
      ORDER_ERROR_CODES.MERCHANT_ORDER_NOT_FOUND,
      DELIVERY_ERROR_CODES.DELIVERY_NOT_FOUND,
    ].join(' or '),
  })
  get(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.deliveries.getMerchantDelivery(
      principal.accountId,
      merchantId,
      orderId,
    );
  }

  @Get('pickup-handoff')
  @ApiOperation({
    summary: 'Ensure or read the Merchant pickup handoff code',
    description:
      'Requires ORDER_READ. Delivery must be AT_PICKUP with an open ACCEPTED assignment. Plaintext pickupCode is returned only here (and on regenerate). Merchant does not verify the code.',
  })
  @ApiOkResponse({ type: MerchantPickupHandoffResponseDto })
  @ApiResponse({
    status: 404,
    description: [
      ORDER_ERROR_CODES.MERCHANT_ORDER_NOT_FOUND,
      DELIVERY_ERROR_CODES.DELIVERY_NOT_FOUND,
    ].join(' or '),
  })
  @ApiResponse({
    status: 409,
    description: PICKUP_HANDOFF_ERROR_CODES.PICKUP_HANDOFF_INVALID_STATE,
  })
  getPickupHandoff(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.pickupHandoffs.getOrIssueForMerchant(
      principal.accountId,
      merchantId,
      orderId,
    );
  }

  @Post('pickup-handoff/regenerate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Invalidate and issue a new Merchant pickup handoff code',
    description:
      'Requires ORDER_READ. Invalidates any PENDING handoff and issues a fresh code for the current assignment.',
  })
  @ApiOkResponse({ type: MerchantPickupHandoffResponseDto })
  @ApiResponse({
    status: 404,
    description: [
      ORDER_ERROR_CODES.MERCHANT_ORDER_NOT_FOUND,
      DELIVERY_ERROR_CODES.DELIVERY_NOT_FOUND,
    ].join(' or '),
  })
  @ApiResponse({
    status: 409,
    description: PICKUP_HANDOFF_ERROR_CODES.PICKUP_HANDOFF_INVALID_STATE,
  })
  regeneratePickupHandoff(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.pickupHandoffs.regenerateForMerchant(
      principal.accountId,
      merchantId,
      orderId,
    );
  }
}
