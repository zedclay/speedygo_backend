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
import { MerchantSettlementService } from '../../application/merchant-settlement.service';

export class MerchantSettlementLineResponseDto {
  @ApiProperty()
  lineId!: string;

  @ApiProperty({ enum: ['SALE', 'REFUND_ADJUSTMENT'] })
  type!: string;

  @ApiProperty({ nullable: true, type: String })
  orderId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  refundId!: string | null;

  @ApiProperty()
  grossMerchandiseMinor!: number;

  @ApiProperty()
  commissionMinor!: number;

  @ApiProperty()
  merchantNetMinor!: number;

  @ApiProperty({
    description:
      'Signed. REFUND_ADJUSTMENT uses negative adjustmentMinor (= -merchantLiability).',
  })
  adjustmentMinor!: number;

  @ApiProperty()
  createdAt!: string;
}

export class MerchantSettlementSummaryResponseDto {
  @ApiProperty()
  settlementId!: string;

  @ApiProperty()
  merchantId!: string;

  @ApiProperty()
  periodStart!: string;

  @ApiProperty()
  periodEnd!: string;

  @ApiProperty({ enum: ['DRAFT', 'FINALIZED'] })
  status!: string;

  @ApiProperty({ example: 'DZD' })
  currency!: string;

  @ApiProperty()
  grossSalesMinor!: number;

  @ApiProperty()
  commissionMinor!: number;

  @ApiProperty({
    description: 'Signed sum of REFUND_ADJUSTMENT.adjustmentMinor values',
  })
  refundAdjustmentTotalMinor!: number;

  @ApiProperty({
    description:
      'Signed net Merchant payable for this batch (may be negative — Merchant owes platform)',
  })
  netPayableMinor!: number;

  @ApiProperty()
  createdAt!: string;
}

export class MerchantSettlementDetailResponseDto extends MerchantSettlementSummaryResponseDto {
  @ApiProperty({ type: [MerchantSettlementLineResponseDto] })
  lines!: MerchantSettlementLineResponseDto[];
}

@ApiTags('merchant-settlements')
@ApiBearerAuth()
@Controller('merchant/:merchantId/settlements')
export class MerchantSettlementController {
  constructor(private readonly settlements: MerchantSettlementService) {}

  @Get()
  @ApiOperation({
    summary: 'List Merchant settlement batches',
    description:
      'OWNER/MANAGER only. Read-only commercial settlement statements. STAFF forbidden. Does not expose COD custody, DriverEarning, provider secrets, or other Merchants. Settlement is not payout.',
  })
  @ApiOkResponse({ type: [MerchantSettlementSummaryResponseDto] })
  list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
  ) {
    return this.settlements.listMerchantSettlements(
      principal.accountId,
      merchantId,
    );
  }

  @Get(':settlementId')
  @ApiOperation({
    summary: 'Read one Merchant settlement with lines',
    description:
      'OWNER/MANAGER only. Foreign/other-Merchant settlement returns not-found. No mutation.',
  })
  @ApiOkResponse({ type: MerchantSettlementDetailResponseDto })
  get(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('settlementId', ParseUUIDPipe) settlementId: string,
  ) {
    return this.settlements.getMerchantSettlement(
      principal.accountId,
      merchantId,
      settlementId,
    );
  }
}
