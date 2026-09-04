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
import { RefundService } from '../../application/refund.service';
import { REFUND_ERROR_CODES } from '../../domain/refund.errors';
import { CustomerOrderRefundsResponseDto } from './dto/customer-refund-response.dto';

@ApiTags('refunds')
@ApiBearerAuth()
@Controller('customer/orders/:orderId/refunds')
export class CustomerRefundController {
  constructor(private readonly refunds: RefundService) {}

  @Get()
  @ApiOperation({
    summary: 'List Refunds for an owned Order',
    description:
      'Authenticated Customer self-read only. Returns safe Refund fields and derived refundable totals. Foreign Orders return REFUND_NOT_FOUND. Does not expose internalNote, Admin IDs, Merchant commission, Driver earning, COD custody, or provider secrets. Does not authorize money return.',
  })
  @ApiOkResponse({ type: CustomerOrderRefundsResponseDto })
  @ApiResponse({
    status: 404,
    description: `${CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND} or ${REFUND_ERROR_CODES.REFUND_NOT_FOUND}`,
  })
  list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.refunds.listCustomerOrderRefunds(principal.accountId, orderId);
  }
}
