import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { RequirePermissions } from '../../../../authorization/require-permissions.decorator';
import { AdminNotificationTemplatesService } from '../../../application/admin-notification-templates.service';
import { ADMIN_PERMISSIONS } from '../../../domain/admin-permissions';
import type { CurrentAdminContext } from '../../../domain/admin.types';
import { CurrentAdmin } from '../../decorators/current-admin.decorator';
import { AdminGuard } from '../../guards/admin.guard';
import { BODY_MAX, TITLE_MAX } from '../../../../notifications/domain/admin-notification-template.policy';

class UpdateAdminNotificationTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(TITLE_MAX)
  titleTemplate!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(BODY_MAX)
  bodyTemplate!: string;

  @IsBoolean()
  active!: boolean;
}

class PreviewAdminNotificationTemplateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(TITLE_MAX)
  titleTemplate?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(BODY_MAX)
  bodyTemplate?: string;
}

@ApiTags('admin-notification-templates')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/notification-templates')
export class AdminNotificationTemplatesController {
  constructor(
    private readonly templates: AdminNotificationTemplatesService,
  ) {}

  @Get()
  @RequirePermissions(ADMIN_PERMISSIONS.SETTINGS_READ)
  @ApiOperation({
    summary: 'List Admin IN_APP notification templates',
    description:
      'Three operational types × fr/ar. SMS/email/push listed as deferred.',
  })
  list() {
    return this.templates.list();
  }

  @Get(':id')
  @RequirePermissions(ADMIN_PERMISSIONS.SETTINGS_READ)
  @ApiOperation({ summary: 'Get one Admin notification template' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.get(id);
  }

  @Put(':id')
  @RequirePermissions(ADMIN_PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({
    summary: 'Update Admin notification template copy',
    description:
      'Does not rewrite existing Notification rows or trigger emissions.',
  })
  update(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAdminNotificationTemplateDto,
  ) {
    return this.templates.update(admin, id, body);
  }

  @Post(':id/preview')
  @HttpCode(200)
  @RequirePermissions(ADMIN_PERMISSIONS.SETTINGS_READ)
  @ApiOperation({
    summary: 'Preview template with labelled example data',
    description: 'Uses the real renderer. Does not persist or send.',
  })
  preview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PreviewAdminNotificationTemplateDto,
  ) {
    return this.templates.preview(id, body);
  }
}
