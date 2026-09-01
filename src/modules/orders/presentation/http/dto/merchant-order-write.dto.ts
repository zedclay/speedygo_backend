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
  MERCHANT_FULFILLMENT_STATUS_FILTERS,
  MERCHANT_ORDER_STATUS_FILTERS,
  MERCHANT_REJECTION_REASON_MAX_LENGTH,
  ORDER_LIST_DEFAULT_LIMIT,
  ORDER_LIST_MAX_LIMIT,
  ORDER_LIST_MAX_OFFSET,
} from '../../../domain/order.policy';

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

export class RejectMerchantOrderDto {
  @ApiProperty({
    maxLength: MERCHANT_REJECTION_REASON_MAX_LENGTH,
    description:
      'Free-text Merchant rejection reason stored on OrderCancellation.reason. No frozen reason-code taxonomy exists.',
  })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(MERCHANT_REJECTION_REASON_MAX_LENGTH)
  reason!: string;
}
