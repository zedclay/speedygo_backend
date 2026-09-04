import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';
import {
  REPORTS_LIST_DEFAULT_LIMIT,
  REPORTS_LIST_MAX_LIMIT,
  REPORTS_LIST_MAX_OFFSET,
} from '../../../domain/reports.policy';

export class ReportWindowQueryDto {
  @ApiProperty({
    description:
      'Inclusive start of half-open interval [from, to). RFC3339 with timezone (UTC preferred). Bare YYYY-MM-DD rejected.',
    example: '2026-01-01T00:00:00.000Z',
  })
  @IsISO8601({ strict: true })
  from!: string;

  @ApiProperty({
    description:
      'Exclusive end of half-open interval [from, to). RFC3339 with timezone (UTC preferred).',
    example: '2026-02-01T00:00:00.000Z',
  })
  @IsISO8601({ strict: true })
  to!: string;
}

export class ReportListWindowQueryDto extends ReportWindowQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: REPORTS_LIST_MAX_LIMIT,
    default: REPORTS_LIST_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(REPORTS_LIST_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: REPORTS_LIST_MAX_OFFSET,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(REPORTS_LIST_MAX_OFFSET)
  offset?: number;
}
