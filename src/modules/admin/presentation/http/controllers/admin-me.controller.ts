import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { CurrentAdminContext } from '../../../domain/admin.types';
import { CurrentAdmin } from '../../decorators/current-admin.decorator';
import { AdminGuard } from '../../guards/admin.guard';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminMeController {
  @Get('me')
  @ApiOperation({
    summary: 'Current AdminProfile + role + permissions',
    description:
      'Requires AdminProfile with an active Role. Does not return tokens or secrets. AdminProfile has no active/suspended field — gate is Role.active.',
  })
  @ApiOkResponse({ description: 'Safe admin context' })
  me(@CurrentAdmin() admin: CurrentAdminContext) {
    return {
      adminProfileId: admin.adminProfileId,
      accountId: admin.accountId,
      displayName: admin.displayName,
      roleId: admin.roleId,
      roleName: admin.roleName,
      permissions: admin.permissions,
    };
  }
}
