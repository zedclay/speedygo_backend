import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../authorization/require-permissions.decorator';
import { AdminRbacService } from '../../../application/admin-rbac.service';
import { ADMIN_PERMISSIONS } from '../../../domain/admin-permissions';
import { CurrentAdmin } from '../../decorators/current-admin.decorator';
import type { CurrentAdminContext } from '../../../domain/admin.types';
import { AdminGuard } from '../../guards/admin.guard';
import {
  AdminRolesListQueryDto,
  CreateAdminRoleDto,
  UpdateAdminRoleDto,
} from '../dto/admin-rbac.dto';

@ApiTags('admin-roles')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminRolesController {
  constructor(private readonly rbac: AdminRbacService) {}

  @Get('permissions')
  @RequirePermissions(ADMIN_PERMISSIONS.ROLES_READ)
  @ApiOperation({
    summary: 'Permission catalogue (seeded; read-only)',
  })
  listPermissions() {
    return this.rbac.listPermissions();
  }

  @Get('roles')
  @RequirePermissions(ADMIN_PERMISSIONS.ROLES_READ)
  @ApiOperation({ summary: 'List roles (paginated)' })
  list(@Query() query: AdminRolesListQueryDto) {
    return this.rbac.listRoles({
      limit: query.limit,
      offset: query.offset,
      q: query.q,
      active: query.active,
    });
  }

  @Get('roles/:id')
  @RequirePermissions(ADMIN_PERMISSIONS.ROLES_READ)
  @ApiOperation({ summary: 'Role detail with permission codes' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.rbac.getRole(id);
  }

  @Post('roles')
  @RequirePermissions(ADMIN_PERMISSIONS.ROLES_MANAGE)
  @ApiOperation({ summary: 'Create role + permission set' })
  create(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Body() body: CreateAdminRoleDto,
  ) {
    return this.rbac.createRole(admin, body);
  }

  @Patch('roles/:id')
  @RequirePermissions(ADMIN_PERMISSIONS.ROLES_MANAGE)
  @ApiOperation({
    summary: 'Update role metadata and/or replace permission set',
  })
  update(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAdminRoleDto,
  ) {
    return this.rbac.updateRole(admin, id, body);
  }
}
