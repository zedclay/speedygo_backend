import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import {
  MERCHANT_REPORT_MAX_CUSTOM_DAYS,
  MERCHANT_REPORT_PERIODS,
  type MerchantReportPeriod,
} from '../../../domain/merchant-sales-report.period';
import {
  MERCHANT_TOP_PRODUCT_SORTS,
  MERCHANT_TOP_PRODUCTS_DEFAULT_LIMIT,
  MERCHANT_TOP_PRODUCTS_MAX_LIMIT,
  type MerchantTopProductSort,
} from '../../../domain/merchant-sales-report.types';

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class MerchantReportQueryDto {
  @ApiProperty({
    enum: MERCHANT_REPORT_PERIODS,
    description:
      'Resolved server-side against the current Africa/Algiers civil date. THIS_WEEK = ISO week (Monday). CUSTOM requires from/to.',
  })
  @IsIn(MERCHANT_REPORT_PERIODS)
  period!: MerchantReportPeriod;

  @ApiPropertyOptional({
    description: `CUSTOM only. Inclusive local date (Africa/Algiers), YYYY-MM-DD. Max ${MERCHANT_REPORT_MAX_CUSTOM_DAYS} days; not after today.`,
    example: '2026-09-01',
  })
  @IsOptional()
  @Matches(LOCAL_DATE)
  from?: string;

  @ApiPropertyOptional({
    description:
      'CUSTOM only. Inclusive local date (Africa/Algiers), YYYY-MM-DD.',
    example: '2026-09-29',
  })
  @IsOptional()
  @Matches(LOCAL_DATE)
  to?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Owned Branch only. Omitted = all Branches of the Merchant.',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class MerchantDailySummaryQueryDto {
  @ApiPropertyOptional({
    description:
      'Local civil day (Africa/Algiers), YYYY-MM-DD. Defaults to today; must not be after today.',
    example: '2026-10-04',
  })
  @IsOptional()
  @Matches(LOCAL_DATE)
  date?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Owned Branch only. Omitted = all Branches of the Merchant.',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class MerchantTopProductsQueryDto extends MerchantReportQueryDto {
  @ApiPropertyOptional({ enum: MERCHANT_TOP_PRODUCT_SORTS, default: 'ORDERS' })
  @IsOptional()
  @IsIn(MERCHANT_TOP_PRODUCT_SORTS)
  sort?: MerchantTopProductSort;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MERCHANT_TOP_PRODUCTS_MAX_LIMIT,
    default: MERCHANT_TOP_PRODUCTS_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MERCHANT_TOP_PRODUCTS_MAX_LIMIT)
  limit?: number;
}
