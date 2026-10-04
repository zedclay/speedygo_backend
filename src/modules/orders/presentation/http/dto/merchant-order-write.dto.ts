import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  MERCHANT_CANCELLATION_REASON_CODES,
  type MerchantCancellationReasonCode,
} from '../../../domain/merchant-cancellation-reason';
import {
  MERCHANT_FULFILLMENT_STATUS_FILTERS,
  MERCHANT_ORDER_STATUS_FILTERS,
  MERCHANT_REJECTION_REASON_MAX_LENGTH,
  ORDER_LIST_DEFAULT_LIMIT,
  ORDER_LIST_MAX_LIMIT,
  ORDER_LIST_MAX_OFFSET,
} from '../../../domain/order.policy';
import {
  PREPARATION_ADD_MINUTES_MAX,
  PREPARATION_ADD_MINUTES_MIN,
  PREPARATION_ESTIMATE_REASON_MAX,
  PREPARATION_MINUTES_MAX,
  PREPARATION_MINUTES_MIN,
} from '../../../domain/preparation-estimate.policy';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class ListMerchantOrdersQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ enum: MERCHANT_ORDER_STATUS_FILTERS })
  @IsOptional()
  @IsIn(MERCHANT_ORDER_STATUS_FILTERS)
  orderStatus?: string;

  @ApiPropertyOptional({ enum: MERCHANT_FULFILLMENT_STATUS_FILTERS })
  @IsOptional()
  @IsIn(MERCHANT_FULFILLMENT_STATUS_FILTERS)
  fulfillmentStatus?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: ORDER_LIST_MAX_LIMIT,
    default: ORDER_LIST_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ORDER_LIST_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: ORDER_LIST_MAX_OFFSET,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(ORDER_LIST_MAX_OFFSET)
  offset?: number;
}

/** Rejects mass-assigned status/body fields on explicit workflow actions. */
export class MerchantOrderActionDto {}

export class AcceptMerchantOrderDto {
  @ApiPropertyOptional({
    minimum: PREPARATION_MINUTES_MIN,
    maximum: PREPARATION_MINUTES_MAX,
    description:
      'Optional. When set, accept persists preparation estimate atomically (clock starts at accept). Omitted preserves legacy accept without estimate.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(PREPARATION_MINUTES_MIN)
  @Max(PREPARATION_MINUTES_MAX)
  preparationMinutes?: number;
}

export class UpdatePreparationEstimateDto {
  @ApiProperty({
    minimum: PREPARATION_ADD_MINUTES_MIN,
    maximum: PREPARATION_ADD_MINUTES_MAX,
  })
  @Type(() => Number)
  @IsInt()
  @Min(PREPARATION_ADD_MINUTES_MIN)
  @Max(PREPARATION_ADD_MINUTES_MAX)
  addMinutes!: number;

  @ApiProperty({
    description: 'Must match current preparationEstimateVersion',
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedEstimateVersion!: number;

  @ApiPropertyOptional({
    maxLength: PREPARATION_ESTIMATE_REASON_MAX,
    description: 'Optional free-text reason for the revision',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MaxLength(PREPARATION_ESTIMATE_REASON_MAX)
  reason?: string;
}

export class RejectMerchantOrderDto {
  @ApiPropertyOptional({
    enum: MERCHANT_CANCELLATION_REASON_CODES,
    description:
      'Optional structured rejection code stored on OrderCancellation.reasonCode. Legacy clients omit it (stored as null).',
  })
  @IsOptional()
  @IsIn(MERCHANT_CANCELLATION_REASON_CODES)
  reasonCode?: MerchantCancellationReasonCode;

  @ApiProperty({
    maxLength: MERCHANT_REJECTION_REASON_MAX_LENGTH,
    description:
      'Free-text Merchant rejection details stored on OrderCancellation.reason. Required even when reasonCode is set.',
  })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(MERCHANT_REJECTION_REASON_MAX_LENGTH)
  reason!: string;
}
