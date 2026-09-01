import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
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
import { DELIVERY_ERROR_CODES } from '../../domain/delivery.errors';
import { MerchantDeliveryResponseDto } from './dto/delivery-response.dto';

@ApiTags('merchant-delivery')
@ApiBearerAuth()
@Controller('merchant/:merchantId/orders/:orderId/delivery')
export class MerchantDeliveryController {
  constructor(private readonly deliveries: DeliveryService) {}

  @Get()
  @ApiOperation({
    summary: 'Get Delivery for a Merchant-owned Order',
    description: [
      'merchantId is selection context only. Requires a live MerchantMember. STAFF may read. SUSPENDED Merchants may read.',
      'Foreign Merchant Orders return MERCHANT_ORDER_NOT_FOUND. Owned Order without Delivery returns DELIVERY_NOT_FOUND (expected until Driver Matching starts).',
      'Pickup is live MerchantBranch (including phone). Dropoff is the Order address snapshot. Driver private data is not returned. SEARCHING_DRIVER with assignedDriverId null is readable before Driver Assignment.',
      'Does not expose driver remuneration or SpeedyGo delivery share. No Merchant Delivery mutation. No public Delivery create.',
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
}
