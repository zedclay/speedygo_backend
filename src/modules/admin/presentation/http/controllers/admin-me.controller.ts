import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import { AdminProfileService } from '../../../application/admin-profile.service';
import type { CurrentAdminContext } from '../../../domain/admin.types';
import { RequireAuthAudience } from '../../../../auth/presentation/http/decorators/require-auth-audience.decorator';
import { CurrentAdmin } from '../../decorators/current-admin.decorator';
import { AdminGuard } from '../../guards/admin.guard';

class UpdateAdminPreferredLocaleDto {
  @IsString()
  @IsIn(['fr', 'ar'])
  preferredLocale!: 'fr' | 'ar';
}

function toMe(admin: CurrentAdminContext) {
  return {
    adminProfileId: admin.adminProfileId,
    accountId: admin.accountId,
    displayName: admin.displayName,
    roleId: admin.roleId,
    roleName: admin.roleName,
    permissions: admin.permissions,
    preferredLocale: admin.preferredLocale,
  };
}

@ApiTags('admin')
@ApiBearerAuth()
@RequireAuthAudience('ADMIN')
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminMeController {
  constructor(private readonly profiles: AdminProfileService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Current AdminProfile + role + permissions',
    description:
      'Requires AdminProfile with an active Role. Does not return tokens or secrets. AdminProfile has no active/suspended field — gate is Role.active. preferredLocale drives Admin UI sync and IN_APP notification emit language.',
  })
  @ApiOkResponse({ description: 'Safe admin context' })
  me(@CurrentAdmin() admin: CurrentAdminContext) {
    return toMe(admin);
  }

  @Put('me/preferred-locale')
  @ApiOperation({
    summary: 'Update own Admin preferred locale',
    description:
      'Persists AdminProfile.preferredLocale (fr|ar). Affects future Admin IN_APP notification copy for this Account only. Does not rewrite existing notifications.',
  })
  async updatePreferredLocale(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Body() body: UpdateAdminPreferredLocaleDto,
  ) {
    const updated = await this.profiles.updatePreferredLocale(
      admin,
      body.preferredLocale,
    );
    return toMe(updated);
  }
}
