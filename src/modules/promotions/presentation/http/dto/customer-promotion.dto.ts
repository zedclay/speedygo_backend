import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  CUSTOMER_PROMOTION_DISCOVERY_DEFAULT_LIMIT,
  CUSTOMER_PROMOTION_DISCOVERY_MAX_LIMIT,
  CUSTOMER_PROMOTION_DISCOUNT_KINDS,
  CUSTOMER_PROMOTION_ELIGIBILITY_DISCOVERABLE,
} from '../../../domain/promotion.types';

export class CustomerPromotionListQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: CUSTOMER_PROMOTION_DISCOVERY_MAX_LIMIT,
    default: CUSTOMER_PROMOTION_DISCOVERY_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CUSTOMER_PROMOTION_DISCOVERY_MAX_LIMIT)
  limit?: number;
}

export class CustomerDiscoverablePromotionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty({
    enum: CUSTOMER_PROMOTION_DISCOUNT_KINDS,
    description:
      'FIXED_MINOR value is integer centimes. RATE_BPS value is integer basis points (1000 = 10%).',
  })
  @IsIn([...CUSTOMER_PROMOTION_DISCOUNT_KINDS])
  discountKind!: string;

  @ApiProperty({
    description:
      'Same units as Promotion.value: minor units for FIXED_MINOR, basis points for RATE_BPS.',
  })
  value!: number;

  @ApiProperty()
  startsAt!: string;

  @ApiProperty()
  endsAt!: string;

  @ApiPropertyOptional({ nullable: true })
  customerLabel!: string | null;

  @ApiProperty({
    enum: [CUSTOMER_PROMOTION_ELIGIBILITY_DISCOVERABLE],
    description:
      'Available to discover. Not a guarantee that Checkout will apply the code to a cart.',
  })
  eligibility!: typeof CUSTOMER_PROMOTION_ELIGIBILITY_DISCOVERABLE;
}

export class CustomerDiscoverablePromotionListDto {
  @ApiProperty({ type: [CustomerDiscoverablePromotionDto] })
  items!: CustomerDiscoverablePromotionDto[];
}
