import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { CurrentPrincipal } from '../../../auth/presentation/http/decorators/current-principal.decorator';
import { DriverRemunerationService } from '../../application/driver-remuneration.service';
import {
  DRIVER_EARNING_LIST_DEFAULT_LIMIT,
  DRIVER_EARNING_LIST_MAX_LIMIT,
} from '../../domain/driver-remuneration.types';

export class DriverEarningSummaryResponseDto {
  @ApiProperty()
  totalEarnedMinor!: number;

  @ApiProperty({
    description:
      'Sum of EARNED (unpaid) net amounts. Not a withdrawable wallet balance.',
  })
  unpaidEarnedMinor!: number;

  @ApiProperty()
  earningCount!: number;

  @ApiProperty({ example: 'DZD' })
  currency!: string;
}

export class DriverEarningItemResponseDto {
  @ApiProperty()
  earningId!: string;

  @ApiProperty()
  deliveryId!: string;

  @ApiProperty()
  orderId!: string;

  @ApiProperty({ description: 'netEarningMinor' })
  amountMinor!: number;

  @ApiProperty({ example: 'DZD' })
  currency!: string;

  @ApiProperty({ enum: ['EARNED'] })
  status!: string;

  @ApiProperty()
  earnedAt!: string;
}

export class DriverEarningListResponseDto {
  @ApiProperty({ type: [DriverEarningItemResponseDto] })
  items!: DriverEarningItemResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  offset!: number;
}

export class ListDriverEarningsQueryDto {
  @ApiProperty({
    required: false,
    default: DRIVER_EARNING_LIST_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(DRIVER_EARNING_LIST_MAX_LIMIT)
  limit?: number;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

@ApiTags('driver-remuneration')
@ApiBearerAuth()
@Controller('driver/earnings')
export class DriverEarningController {
  constructor(private readonly remuneration: DriverRemunerationService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Read own Driver earning totals',
    description:
      'Self-only. totalEarnedMinor / unpaidEarnedMinor from DriverEarning rows. Not COD custody and not a payout wallet. Allowed when SUSPENDED or license expired.',
  })
  @ApiOkResponse({ type: DriverEarningSummaryResponseDto })
  getSummary(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.remuneration.getSummary(principal.accountId);
  }

  @Get()
  @ApiOperation({
    summary: 'List own Driver earnings',
    description:
      'Self-only, paginated newest-first. Returns deliveryId/orderId references without Customer/Merchant financials or COD custody. No mutation or payout.',
  })
  @ApiOkResponse({ type: DriverEarningListResponseDto })
  list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() query: ListDriverEarningsQueryDto,
  ) {
    return this.remuneration.listEarnings(principal.accountId, query);
  }
}
