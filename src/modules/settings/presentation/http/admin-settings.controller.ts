import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../authorization/require-permissions.decorator';
import { ADMIN_PERMISSIONS } from '../../../admin/domain/admin-permissions';
import type { CurrentAdminContext } from '../../../admin/domain/admin.types';
import { CurrentAdmin } from '../../../admin/presentation/decorators/current-admin.decorator';
import { AdminGuard } from '../../../admin/presentation/guards/admin.guard';
import { SettingsService } from '../../application/settings.service';
import { UpdatePlatformSettingDto } from './dto/settings.dto';

@ApiTags('admin-settings')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermissions(ADMIN_PERMISSIONS.SETTINGS_READ)
  @ApiOperation({
    summary:
      'List allowlisted platform settings (application defaults when no DB row)',
  })
  list() {
    return this.settings.listSettings();
  }

  @Get(':key')
  @RequirePermissions(ADMIN_PERMISSIONS.SETTINGS_READ)
  @ApiOperation({
    summary: 'Get one allowlisted platform setting by key',
  })
  get(@Param('key') key: string) {
    return this.settings.getSetting(key);
  }

  @Put(':key')
  @RequirePermissions(ADMIN_PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({
    summary:
      'Update one allowlisted platform setting (atomic AuditLog; idempotent no-op)',
  })
  update(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('key') key: string,
    @Body() body: UpdatePlatformSettingDto,
  ) {
    return this.settings.updateSetting(admin, key, body.value);
  }
}
