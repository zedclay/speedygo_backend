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
import type { AdminAccountStatus } from '../../../domain/admin-rbac.types';
import { CurrentAdmin } from '../../decorators/current-admin.decorator';
import type { CurrentAdminContext } from '../../../domain/admin.types';
import { AdminGuard } from '../../guards/admin.guard';
import {
  AdminAdminsListQueryDto,
  CreateAdminProfileDto,
  UpdateAdminProfileDto,
} from '../dto/admin-rbac.dto';

@ApiTags('admin-admins')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/admins')
export class AdminAdminsController {
  constructor(private readonly rbac: AdminRbacService) {}

  @Get()
  @RequirePermissions(ADMIN_PERMISSIONS.ADMINS_READ)
  @ApiOperation({ summary: 'List administrators (paginated, server filters)' })
  list(@Query() query: AdminAdminsListQueryDto) {
    return this.rbac.listAdmins({
      limit: query.limit,
      offset: query.offset,
      q: query.q,
      roleId: query.roleId,
      accountStatus: query.accountStatus as AdminAccountStatus | undefined,
    });
  }

  @Get(':id')
  @RequirePermissions(ADMIN_PERMISSIONS.ADMINS_READ)
  @ApiOperation({ summary: 'Administrator detail' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.rbac.getAdmin(id);
  }

  @Post()
  @RequirePermissions(ADMIN_PERMISSIONS.ADMINS_MANAGE)
  @ApiOperation({
    summary: 'Create administrator',
    description:
      'Creates or links Account + AdminProfile. Login remains OTP — no invitation email/password.',
  })
  create(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Body() body: CreateAdminProfileDto,
  ) {
    return this.rbac.createAdmin(admin, {
      displayName: body.displayName,
      roleId: body.roleId,
      phone: body.phone,
      email: body.email,
      accountStatus: body.accountStatus as AdminAccountStatus | undefined,
    });
  }

  @Patch(':id')
  @RequirePermissions(ADMIN_PERMISSIONS.ADMINS_MANAGE)
  @ApiOperation({
    summary: 'Update administrator displayName / role / Account.status',
  })
  update(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAdminProfileDto,
  ) {
    return this.rbac.updateAdmin(admin, id, body);
  }
}
