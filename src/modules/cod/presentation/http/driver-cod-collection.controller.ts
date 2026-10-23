import {
  Body,
  Controller,
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
import { CollectCodDto } from './dto/collect-cod.dto';

@ApiTags('cod')
@ApiBearerAuth()
@Controller('driver/deliveries/current')
export class DriverCodCollectionController {
  constructor(private readonly cod: CodFoundationService) {}

  @Post('collect-cod')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Collect COD cash at ARRIVED_CUSTOMER',
    description:
      'minor-v1: collectedAmountMinor centimes. dzd-v2: collectedAmount "650.00". Response *Minor fields remain centimes.',
  })
  @ApiOkResponse({ description: 'COD collected successfully.' })
  async collectCod(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: CollectCodDto,
    @Headers() headers: Record<string, unknown>,
  ) {
    const amountMinor = resolveWriteCentimes({
      headers,
      minorField: body.collectedAmountMinor,
      dzdField: body.collectedAmount,
      fieldLabel: 'collectedAmount',
    });
    return this.cod.collectCod(principal.accountId, amountMinor);
  }
}
