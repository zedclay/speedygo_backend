import {
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../../auth/presentation/http/decorators/public.decorator';
import { PaymentService } from '../../application/payment.service';
import { PAYMENT_ERROR_CODES } from '../../domain/payment.errors';
import { PAYMENT_PROVIDER_CHARGILY } from '../../domain/payment.policy';
import { PaymentWebhookAcceptedDto } from './dto/payment-response.dto';

@ApiTags('payments')
@Controller('payments/webhooks')
export class PaymentWebhookController {
  constructor(private readonly payments: PaymentService) {}

  @Post(':provider')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Provider webhook for electronic Payment confirmation',
    description:
      'Public machine webhook. Chargily Pay V2 uses header `signature` (HMAC-SHA256 of raw body). The test adapter uses `X-SpeedyGo-Signature`. Does not accept Customer-supplied success. Does not mutate Order, Fulfillment, or Delivery.',
  })
  @ApiOkResponse({ type: PaymentWebhookAcceptedDto })
  @ApiResponse({
    status: 401,
    description: PAYMENT_ERROR_CODES.PAYMENT_WEBHOOK_INVALID_SIGNATURE,
  })
  @ApiResponse({
    status: 404,
    description: PAYMENT_ERROR_CODES.PAYMENT_WEBHOOK_UNKNOWN_REFERENCE,
  })
  handle(
    @Param('provider') provider: string,
    @Req() request: RawBodyRequest<Request>,
  ) {
    const headerName =
      provider === PAYMENT_PROVIDER_CHARGILY
        ? 'signature'
        : 'x-speedygo-signature';
    const signatureHeader = request.headers[headerName];
    const signature = Array.isArray(signatureHeader)
      ? signatureHeader[0]
      : signatureHeader;
    return this.payments.handleProviderWebhook(
      provider,
      request.rawBody,
      signature,
    );
  }
}
