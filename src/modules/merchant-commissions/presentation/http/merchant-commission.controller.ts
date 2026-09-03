import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { CurrentPrincipal } from '../../../auth/presentation/http/decorators/current-principal.decorator';
import { MerchantCommissionService } from '../../application/merchant-commission.service';

export class MerchantEffectiveCommissionResponseDto {
  @ApiProperty()
  merchantId!: string;

  @ApiProperty({ enum: ['GLOBAL_DEFAULT', 'MERCHANT_OVERRIDE'] })
  scope!: string;

  @ApiProperty({ description: 'Integer basis points. 700 = 7%.' })
  rateBps!: number;

  @ApiProperty()
  ruleId!: string;

  @ApiProperty()
  effectiveFrom!: string;

  @ApiProperty({ nullable: true, type: String })
  effectiveTo!: string | null;
}

@ApiTags('merchant-commission')
@ApiBearerAuth()
@Controller('merchant/:merchantId/commission')
export class MerchantCommissionController {
  constructor(private readonly commission: MerchantCommissionService) {}

  @Get()
  @ApiOperation({
    summary: 'Read the Merchant effective commission configuration',
    description:
      'OWNER and MANAGER only. Returns the currently applicable rule for this Merchant (override if active, otherwise global default). Does not expose other Merchants, Admin ids, or mutation. STAFF cannot read live configuration; per-Order snapshot commission remains on Merchant Order reads. No Admin mutation HTTP in this phase.',
  })
  @ApiOkResponse({ type: MerchantEffectiveCommissionResponseDto })
  getEffective(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
  ) {
    return this.commission.getMerchantEffectiveCommission(
      principal.accountId,
      merchantId,
    );
  }
}
