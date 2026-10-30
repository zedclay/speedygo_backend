import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AdminSearchService } from '../../../application/admin-search.service';
import {
  ADMIN_SEARCH_MAX_LENGTH,
  ADMIN_SEARCH_MAX_LIMIT_PER_TYPE,
} from '../../../domain/admin-search.policy';
import type { CurrentAdminContext } from '../../../domain/admin.types';
import { CurrentAdmin } from '../../decorators/current-admin.decorator';
import { AdminGuard } from '../../guards/admin.guard';

class AdminSearchQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(ADMIN_SEARCH_MAX_LENGTH * 2)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  types?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ADMIN_SEARCH_MAX_LIMIT_PER_TYPE)
  limitPerType?: number;
}

@ApiTags('admin-search')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/search')
export class AdminSearchController {
  constructor(private readonly search: AdminSearchService) {}

  @Get()
  @ApiOperation({
    summary: 'Bounded Admin global search',
    description:
      'Permission-gated entity groups (customers/merchants/drivers/orders/support). No internal notes or secrets. Totals before per-type limit. See ADMIN_GLOBAL_SEARCH_FOUNDATION.md.',
  })
  run(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Query() query: AdminSearchQueryDto,
  ) {
    return this.search.search(admin, query);
  }
}
