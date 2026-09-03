import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Body,
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
import { CUSTOMER_ERROR_CODES } from '../../../customers/domain/customer.errors';
import { PaymentService } from '../../application/payment.service';
import { PAYMENT_ERROR_CODES } from '../../domain/payment.errors';
import {
  CustomerPaymentInitiateResponseDto,
  CustomerPaymentResponseDto,
} from './dto/payment-response.dto';
import { InitiatePaymentDto } from './dto/payment-write.dto';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('customer/orders/:orderId/payment')
export class CustomerPaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Get()
  @ApiOperation({
    summary: 'Read the authenticated Customer’s Payment for an owned Order',
    description:
      'Returns the current Payment aggregate only. Foreign Orders return PAYMENT_NOT_FOUND. Does not expose Merchant commission, Driver remuneration, webhook payloads, or provider secrets. COD Payments are readable while PENDING.',
  })
  @ApiOkResponse({ type: CustomerPaymentResponseDto })
  @ApiResponse({
    status: 404,
    description: `${CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND} or ${PAYMENT_ERROR_CODES.PAYMENT_NOT_FOUND}`,
  })
  get(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.payments.getCustomerPayment(principal.accountId, orderId);
  }

  @Post('initiate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Initiate electronic payment for an owned Order',
    description:
      'Creates or reuses a provider checkout attempt against the existing Payment aggregate. Empty body. Amount and currency come from frozen Payment / OrderFinancialSnapshot values. Body fields such as amount, amountMinor, currency, status, customerId, paymentId, and providerReference are rejected. Client Idempotency-Key is not required in v1.0. COD Payments cannot be initiated. SUCCEEDED Payments cannot start another attempt.',
  })
  @ApiOkResponse({ type: CustomerPaymentInitiateResponseDto })
  @ApiResponse({
    status: 404,
    description: `${CUSTOMER_ERROR_CODES.CUSTOMER_PROFILE_NOT_FOUND} or ${PAYMENT_ERROR_CODES.PAYMENT_NOT_FOUND}`,
  })
  @ApiResponse({
    status: 409,
    description: [
      PAYMENT_ERROR_CODES.PAYMENT_METHOD_NOT_ELECTRONIC,
      PAYMENT_ERROR_CODES.PAYMENT_ALREADY_SUCCEEDED,
      PAYMENT_ERROR_CODES.PAYMENT_NOT_INITIABLE,
      PAYMENT_ERROR_CODES.PAYMENT_AMOUNT_MISMATCH,
      PAYMENT_ERROR_CODES.PAYMENT_CURRENCY_MISMATCH,
      PAYMENT_ERROR_CODES.PAYMENT_INVALID_STATE,
    ].join(' or '),
  })
  @ApiResponse({
    status: 503,
    description: `${PAYMENT_ERROR_CODES.PAYMENT_PROVIDER_UNAVAILABLE} or ${PAYMENT_ERROR_CODES.PAYMENT_PROVIDER_CONFIGURATION_INVALID}`,
  })
  initiate(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() _body: InitiatePaymentDto,
  ) {
    return this.payments.initiateCustomerPayment(principal.accountId, orderId);
  }
}
