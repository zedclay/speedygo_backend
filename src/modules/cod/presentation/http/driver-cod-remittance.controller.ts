import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { CurrentPrincipal } from '../../../auth/presentation/http/decorators/current-principal.decorator';
import { SubmitCodRemittanceDto } from './dto/submit-cod-remittance.dto';
import { CodFoundationService } from '../../application/cod-foundation.service';

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
      'Creates one DECLARED remittance (at most one open DECLARED per Driver). Does not allocate custody and does not reduce outstanding custody. Authoritative confirmation is internal-only.',
  })
  @ApiOkResponse({ description: 'COD remittance declared.' })
  async submitRemittance(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: SubmitCodRemittanceDto,
  ) {
    return this.cod.submitCodRemittance(
      principal.accountId,
      body.submittedAmountMinor,
    );
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Read own Driver COD custody outstanding',
    description:
      'Self-only. outstandingCustodyMinor = SUM(COLLECTED amounts) − SUM(confirmed allocations). Declarations do not reduce custody. Allowed when OFFLINE/SUSPENDED.',
  })
  @ApiOkResponse({ description: 'COD custody summary.' })
  async getSummary(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.cod.getDriverCodSummary(principal.accountId);
  }
}
