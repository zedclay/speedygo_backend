import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN } from '../../../../common/money/money-minor';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MaxLength,
} from 'class-validator';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { CurrentPrincipal } from '../../../auth/presentation/http/decorators/current-principal.decorator';
import { DriverDeliveryHistoryService } from '../../application/driver-delivery-history.service';
import {
  DRIVER_DELIVERY_HISTORY_LIST_DEFAULT_LIMIT,
  DRIVER_DELIVERY_HISTORY_LIST_MAX_LIMIT,
} from '../../domain/driver-delivery-history.types';

export class DriverDeliveryHistoryEarningDto {
  @ApiProperty()
  earningId!: string;

  @ApiProperty({
    type: String,
    pattern: MONEY_MINOR_NONNEGATIVE_DECIMAL_STRING_PATTERN,
    description:
      'Persisted DriverEarning.netEarningMinor. Recognition only — not paid, transferred, or payout.',
    example: '300',
  })
  earningAmountMinor!: string;

  @ApiProperty({ example: 'DZD' })
  currency!: string;

  @ApiProperty({
    enum: ['EARNED'],
    description: 'EARNED means recognized. Not a payout claim.',
  })
  earningStatus!: string;

  @ApiProperty()
  earnedAt!: string;
}

export class DriverDeliveryHistoryItemDto {
  @ApiProperty()
  deliveryId!: string;

  @ApiProperty()
  orderPublicReference!: string;

  @ApiProperty({ enum: ['DELIVERED'] })
  deliveryStatus!: string;

  @ApiProperty({
    description: 'Authoritative Delivery.deliveredAt (UTC). Sort key.',
  })
  deliveredAt!: string;

  @ApiProperty()
  merchantName!: string;

  @ApiProperty()
  branchName!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  paymentMethod!: string | null;

  @ApiProperty({ type: DriverDeliveryHistoryEarningDto })
  earning!: DriverDeliveryHistoryEarningDto;
}

export class DriverDeliveryHistoryListResponseDto {
  @ApiProperty({ type: [DriverDeliveryHistoryItemDto] })
  items!: DriverDeliveryHistoryItemDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  offset!: number;
}

export class DriverDeliveryHistoryDetailDto extends DriverDeliveryHistoryItemDto {
  @ApiPropertyOptional({ nullable: true, type: String })
  pickedUpAt!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  arrivedCustomerAt!: string | null;
}

export class ListDriverDeliveryHistoryQueryDto {
  @ApiProperty({
    required: false,
    default: DRIVER_DELIVERY_HISTORY_LIST_DEFAULT_LIMIT,
    maximum: DRIVER_DELIVERY_HISTORY_LIST_MAX_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(DRIVER_DELIVERY_HISTORY_LIST_MAX_LIMIT)
  limit?: number;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({
    description:
      'Optional window start (inclusive). RFC3339 with timezone. Pair with to. Half-open [from,to) on deliveredAt. Bare YYYY-MM-DD rejected. Max 93 days.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  from?: string;

  @ApiPropertyOptional({
    description:
      'Optional window end (exclusive). RFC3339 with timezone. Pair with from.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  to?: string;
}

@ApiTags('driver-delivery-history')
@ApiBearerAuth()
@Controller('driver/deliveries/history')
export class DriverDeliveryHistoryController {
  constructor(private readonly history: DriverDeliveryHistoryService) {}

  @Get()
  @ApiOperation({
    summary: 'List completed deliveries served by the authenticated Driver',
    description:
      'Completed-only history: DELIVERED + deliveredAt + RELEASED serving assignment for this Driver whose DriverEarning.driverId matches (RELEASED alone is insufficient). Matching OFFERED/REJECTED/EXPIRED and active ACCEPTED work are excluded. Newest deliveredAt first. Money is decimal string. Earning is recognition (EARNED), not payout. No Customer PII, GPS trails, Rating comments, COD custody, Merchant finance, orderId, or assignmentId. Optional [from,to) on deliveredAt (RFC3339, max 93 days). Offset max 10_000 (cursor pagination is a future option).',
  })
  @ApiOkResponse({ type: DriverDeliveryHistoryListResponseDto })
  list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() query: ListDriverDeliveryHistoryQueryDto,
  ) {
    return this.history.listHistory(principal.accountId, query);
  }

  @Get(':deliveryId')
  @ApiOperation({
    summary: 'Read one completed Delivery from own Driver history',
    description:
      'Self-serving completed Delivery only. Foreign/non-serving/active Delivery → DRIVER_DELIVERY_HISTORY_NOT_FOUND. Omits orderId/assignmentId, Customer contact/address, GPS trail, Rating comments, Merchant commission/settlement, COD balances. RELEASED alone without matching DriverEarning does not qualify.',
  })
  @ApiOkResponse({ type: DriverDeliveryHistoryDetailDto })
  detail(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('deliveryId', ParseUUIDPipe) deliveryId: string,
  ) {
    return this.history.getHistoryDetail(principal.accountId, deliveryId);
  }
}
