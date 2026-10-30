import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AdminNotificationsService } from '../../../application/admin-notifications.service';
import type { CurrentAdminContext } from '../../../domain/admin.types';
import {
  ADMIN_LIST_MAX_LIMIT,
  ADMIN_LIST_MAX_OFFSET,
} from '../../../domain/admin.types';
import { CurrentAdmin } from '../../decorators/current-admin.decorator';
import { AdminGuard } from '../../guards/admin.guard';

class AdminNotificationsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ADMIN_LIST_MAX_LIMIT)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(ADMIN_LIST_MAX_OFFSET)
  offset?: number;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  unreadOnly?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  types?: string;
}

@ApiTags('admin-notifications')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/notifications')
export class AdminNotificationsController {
  constructor(private readonly inbox: AdminNotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'Admin operational notifications inbox',
    description:
      'Own Account rows ∩ Admin types ∩ current permissions. See ADMIN_OPERATIONAL_NOTIFICATIONS.md.',
  })
  list(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Query() query: AdminNotificationsQueryDto,
  ) {
    return this.inbox.list(admin, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread Admin inbox count (permission-filtered)' })
  unreadCount(@CurrentAdmin() admin: CurrentAdminContext) {
    return this.inbox.unreadCount(admin);
  }

  @Post('read-all')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mark all visible Admin notifications as read',
    description:
      'Scope = current permission-visible Admin types on this Account only.',
  })
  markAllRead(@CurrentAdmin() admin: CurrentAdminContext) {
    return this.inbox.markAllRead(admin);
  }

  @Post(':id/read')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mark one own visible Admin notification as read',
    description: 'Idempotent. Foreign or unauthorized id → 404.',
  })
  markRead(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inbox.markRead(admin, id);
  }
}
