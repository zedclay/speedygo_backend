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
import { CUSTOMER_ERROR_CODES } from '../../../customers/domain/customer.errors';
import { ORDER_ERROR_CODES } from '../../../orders/domain/order.errors';
import { DeliveryService } from '../../application/delivery.service';
import { DELIVERY_ERROR_CODES } from '../../domain/delivery.errors';
import { CustomerDeliveryResponseDto } from './dto/delivery-response.dto';

@ApiTags('customer-delivery')
@ApiBearerAuth()
@Controller('customer/orders/:orderId/delivery')
export class CustomerDeliveryController {
  constructor(private readonly deliveries: DeliveryService) {}

  @Get()
  @ApiOperation({
    summary: 'Get Delivery for an owned Customer Order',
    description: [
      'Returns the Delivery linked to the Order if it exists. Foreign Orders return ORDER_NOT_FOUND. Owned Order without Delivery returns DELIVERY_NOT_FOUND (expected after Merchant READY until Driver Matching starts).',
      'Dropoff is OrderDeliveryAddressSnapshot, not the live Customer Address. Pickup is live MerchantBranch data (no phone). SEARCHING_DRIVER with assignedDriverId null is readable before Driver Assignment.',
      'Does not expose Merchant commission, driver remuneration, SpeedyGo share, or Customer auth identifiers. Reads never mutate Delivery.',
      'There is no public Delivery create or PATCH status endpoint. Delivery creation is internal Driver Matching orchestration only.',
    ].join(' '),
  })
  @ApiOkResponse({ type: CustomerDeliveryResponseDto })
  @ApiResponse({
    status: 404,
    description: [
      CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND,
      ORDER_ERROR_CODES.ORDER_NOT_FOUND,
      DELIVERY_ERROR_CODES.DELIVERY_NOT_FOUND,
    ].join(' or '),
  })
  get(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.deliveries.getCustomerDelivery(principal.accountId, orderId);
  }
}
