import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { resolveWriteCentimes } from '../../../../common/money/resolve-money-write';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { CurrentPrincipal } from '../../../auth/presentation/http/decorators/current-principal.decorator';
import { CodFoundationService } from '../../application/cod-foundation.service';
import { SubmitCodRemittanceDto } from './dto/submit-cod-remittance.dto';

@ApiTags('cod')
@ApiBearerAuth()
@Controller('driver/cod')
export class DriverCodRemittanceController {
  constructor(private readonly cod: CodFoundationService) {}

  @Post('remittances')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Declare COD remittance to SpeedyGo',
    description:
      'minor-v1: body.submittedAmountMinor = integer centimes. dzd-v2 (X-SpeedyGo-Money-Contract: dzd-v2): body.submittedAmount = "650.00". *Minor response fields remain centimes digit-strings.',
  })
  @ApiOkResponse({ description: 'COD remittance declared.' })
  async submitRemittance(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: SubmitCodRemittanceDto,
    @Headers() headers: Record<string, unknown>,
  ) {
    const amountMinor = resolveWriteCentimes({
      headers,
      minorField: body.submittedAmountMinor,
      dzdField: body.submittedAmount,
      fieldLabel: 'submittedAmount',
    });
    return this.cod.submitCodRemittance(principal.accountId, amountMinor);
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Read own Driver COD custody outstanding',
    description:
      'Self-only. outstandingCustodyMinor = SUM(COLLECTED amounts) − SUM(confirmed allocations) as integer centimes digit-string.',
  })
  @ApiOkResponse({ description: 'COD custody summary.' })
  async getSummary(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.cod.getDriverCodSummary(principal.accountId);
  }
}
