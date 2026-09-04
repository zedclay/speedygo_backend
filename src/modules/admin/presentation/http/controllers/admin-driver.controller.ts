import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../../../../authorization/require-permissions.decorator';
import { DRIVER_VERIFICATION_PENDING_REVIEW } from '../../../../drivers/domain/driver.policy';
import { AdminDriverCommandsService } from '../../../application/admin-driver-commands.service';
import { ADMIN_PERMISSIONS } from '../../../domain/admin-permissions';
import type { CurrentAdminContext } from '../../../domain/admin.types';
import { AdminQueryRepository } from '../../../infrastructure/admin-query.repository';
import { CurrentAdmin } from '../../decorators/current-admin.decorator';
import { AdminGuard } from '../../guards/admin.guard';
import {
  AdminDriverListQueryDto,
  AdminEmptyBodyDto,
  AdminListQueryDto,
} from '../dto/admin.dto';

@ApiTags('admin-drivers')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/drivers')
export class AdminDriverController {
  constructor(
    private readonly queries: AdminQueryRepository,
    private readonly commands: AdminDriverCommandsService,
  ) {}

  @Get()
  @RequirePermissions(ADMIN_PERMISSIONS.DRIVERS_READ)
  @ApiOperation({ summary: 'List drivers (paginated)' })
  @ApiOkResponse({ description: 'Driver list' })
  list(@Query() query: AdminDriverListQueryDto) {
    return this.queries.listDrivers(query);
  }

  @Get('verification/queue')
  @RequirePermissions(ADMIN_PERMISSIONS.DRIVERS_VERIFY)
  @ApiOperation({ summary: 'Driver verification queue (PENDING_REVIEW)' })
  queue(@Query() query: AdminListQueryDto) {
    return this.queries.listDrivers({
      ...query,
      verificationStatus: DRIVER_VERIFICATION_PENDING_REVIEW,
    });
  }

  @Get(':id')
  @RequirePermissions(ADMIN_PERMISSIONS.DRIVERS_READ)
  @ApiOperation({ summary: 'Driver detail' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.queries.getDriver(id);
  }

  @Post(':id/verification/approve')
  @RequirePermissions(ADMIN_PERMISSIONS.DRIVERS_VERIFY)
  @ApiOperation({ summary: 'Approve driver verification' })
  approve(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _body: AdminEmptyBodyDto,
  ) {
    return this.commands.approveVerification(admin, id);
  }

  @Post(':id/verification/reject')
  @RequirePermissions(ADMIN_PERMISSIONS.DRIVERS_VERIFY)
  @ApiOperation({ summary: 'Reject driver verification' })
  reject(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _body: AdminEmptyBodyDto,
  ) {
    return this.commands.rejectVerification(admin, id);
  }

  @Post(':id/suspend')
  @RequirePermissions(ADMIN_PERMISSIONS.DRIVERS_SUSPEND)
  @ApiOperation({ summary: 'Suspend an approved driver' })
  suspend(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _body: AdminEmptyBodyDto,
  ) {
    return this.commands.suspend(admin, id);
  }
}
