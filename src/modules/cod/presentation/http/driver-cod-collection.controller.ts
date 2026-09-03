import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { CurrentPrincipal } from '../../../auth/presentation/http/decorators/current-principal.decorator';
import { CollectCodDto } from './dto/collect-cod.dto';
import { CodFoundationService } from '../../application/cod-foundation.service';

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
      'Exact-only Customer cash collection. Creates one CodCollection per Order and atomically moves COD Payment PENDING → SUCCEEDED. Safe replay of the same exact amount reuses the existing collection. Does not complete Delivery.',
  })
  @ApiOkResponse({ description: 'COD collected successfully.' })
  async collectCod(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: CollectCodDto,
  ) {
    return this.cod.collectCod(principal.accountId, body.collectedAmountMinor);
  }
}
