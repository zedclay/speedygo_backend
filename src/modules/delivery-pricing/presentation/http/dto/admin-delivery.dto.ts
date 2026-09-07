import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  ADMIN_LIST_DEFAULT_LIMIT,
  ADMIN_LIST_MAX_LIMIT,
  ADMIN_LIST_MAX_OFFSET,
} from '../../../../admin/domain/admin.types';
import { DELIVERY_TIME_BANDS } from '../../../domain/delivery-pricing.types';

/** Maximum minor-unit value accepted on Admin input (safe integer cap). */
const MONEY_MINOR_MAX = 2_147_483_647; // 2^31-1 (PostgreSQL bigint is larger; we cap here for safety)

const DELIVERY_ZONE_SORT_OPTIONS = ['createdAt', 'updatedAt', 'name'] as const;
const DELIVERY_RULE_SORT_OPTIONS = ['createdAt', 'effectiveFrom'] as const;
const SORT_DIR_OPTIONS = ['ASC', 'DESC'] as const;
const TIME_LOCAL_PATTERN = /^\d{2}:\d{2}:\d{2}$/;

// ---------------------------------------------------------------------------
// Zone list query
// ---------------------------------------------------------------------------

export class AdminDeliveryZoneListQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: ADMIN_LIST_MAX_LIMIT,
    default: ADMIN_LIST_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ADMIN_LIST_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: ADMIN_LIST_MAX_OFFSET,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(ADMIN_LIST_MAX_OFFSET)
  offset?: number;

  @ApiPropertyOptional({ enum: DELIVERY_ZONE_SORT_OPTIONS })
  @IsOptional()
  @IsIn([...DELIVERY_ZONE_SORT_OPTIONS])
  sortBy?: (typeof DELIVERY_ZONE_SORT_OPTIONS)[number];

  @ApiPropertyOptional({ enum: SORT_DIR_OPTIONS })
  @IsOptional()
  @IsIn([...SORT_DIR_OPTIONS])
  sortDir?: 'ASC' | 'DESC';

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  active?: boolean;
}

// ---------------------------------------------------------------------------
// Zone create/update
// ---------------------------------------------------------------------------

export class CreateAdminDeliveryZoneDto {
  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  /**
   * GeoJSON Polygon (plain object — no Feature/FeatureCollection wrapper).
   * Coordinate order: [longitude, latitude], SRID 4326.
   * Must be a single closed ring with 4–2000 positions and no holes.
   * Stored as MultiPolygon. Active overlap rejected with DELIVERY_ZONE_OVERLAP.
   */
  @ApiProperty({
    description:
      'GeoJSON Polygon with [lon, lat] coordinate order. No holes. 4–2000 positions.',
    example: {
      type: 'Polygon',
      coordinates: [
        [
          [3.0, 36.7],
          [3.1, 36.7],
          [3.1, 36.8],
          [3.0, 36.8],
          [3.0, 36.7],
        ],
      ],
    },
  })
  @IsObject()
  geometry!: object;
}

export class UpdateAdminDeliveryZoneDto {
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({
    description:
      'New GeoJSON Polygon geometry. Omit to keep existing geometry.',
    example: {
      type: 'Polygon',
      coordinates: [
        [
          [3.0, 36.7],
          [3.1, 36.7],
          [3.1, 36.8],
          [3.0, 36.8],
          [3.0, 36.7],
        ],
      ],
    },
  })
  @IsOptional()
  @IsObject()
  geometry?: object;
}

// ---------------------------------------------------------------------------
// Pricing rule list query
// ---------------------------------------------------------------------------

export class AdminDeliveryPricingRuleListQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: ADMIN_LIST_MAX_LIMIT,
    default: ADMIN_LIST_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ADMIN_LIST_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: ADMIN_LIST_MAX_OFFSET,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(ADMIN_LIST_MAX_OFFSET)
  offset?: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ enum: DELIVERY_RULE_SORT_OPTIONS })
  @IsOptional()
  @IsIn([...DELIVERY_RULE_SORT_OPTIONS])
  sortBy?: (typeof DELIVERY_RULE_SORT_OPTIONS)[number];

  @ApiPropertyOptional({ enum: SORT_DIR_OPTIONS })
  @IsOptional()
  @IsIn([...SORT_DIR_OPTIONS])
  sortDir?: 'ASC' | 'DESC';
}

// ---------------------------------------------------------------------------
// Pricing rule create
// ---------------------------------------------------------------------------

export class CreateAdminDeliveryPricingRuleDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  zoneId!: string;

  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @ApiProperty({ enum: DELIVERY_TIME_BANDS })
  @IsIn([...DELIVERY_TIME_BANDS])
  timeBand!: string;

  @ApiPropertyOptional({
    description:
      'HH:MM:SS local time (Africa/Algiers). Must be set together with endLocalTime.',
    pattern: '^\\d{2}:\\d{2}:\\d{2}$',
  })
  @IsOptional()
  @IsString()
  @Matches(TIME_LOCAL_PATTERN)
  startLocalTime?: string;

  @ApiPropertyOptional({
    description:
      'HH:MM:SS local time (Africa/Algiers). Must be set together with startLocalTime.',
    pattern: '^\\d{2}:\\d{2}:\\d{2}$',
  })
  @IsOptional()
  @IsString()
  @Matches(TIME_LOCAL_PATTERN)
  endLocalTime?: string;

  @ApiProperty({
    minimum: 0,
    maximum: MONEY_MINOR_MAX,
    description:
      'Customer delivery fee in minor units (integer). Must be >= driverRemunerationMinor.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MONEY_MINOR_MAX)
  customerDeliveryFeeMinor!: number;

  @ApiProperty({
    minimum: 0,
    maximum: MONEY_MINOR_MAX,
    description:
      'Driver remuneration in minor units (integer). Must be <= customerDeliveryFeeMinor.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MONEY_MINOR_MAX)
  driverRemunerationMinor!: number;

  @ApiProperty({
    description: 'ISO 8601 timestamp from which the rule is effective.',
  })
  @IsISO8601()
  effectiveFrom!: string;

  @ApiPropertyOptional({
    description:
      'ISO 8601 timestamp at which the rule expires. Must be after effectiveFrom.',
  })
  @IsOptional()
  @IsISO8601()
  effectiveTo?: string;
}
