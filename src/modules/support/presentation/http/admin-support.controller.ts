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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../authorization/require-permissions.decorator';
import { ADMIN_PERMISSIONS } from '../../../admin/domain/admin-permissions';
import type { CurrentAdminContext } from '../../../admin/domain/admin.types';
import { CurrentAdmin } from '../../../admin/presentation/decorators/current-admin.decorator';
import { AdminGuard } from '../../../admin/presentation/guards/admin.guard';
import { SupportAdminService } from '../../application/support-admin.service';
import {
  AdminSupportAssignDto,
  AdminSupportListQueryDto,
  AdminSupportPriorityDto,
  SupportListQueryDto,
  SupportMessageBodyDto,
} from './dto/support.dto';

@ApiTags('admin-support')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/support')
export class AdminSupportController {
  constructor(private readonly supportAdmin: SupportAdminService) {}

  @Get()
  @RequirePermissions(ADMIN_PERMISSIONS.SUPPORT_READ)
  @ApiOperation({
    summary: 'List Support tickets',
    description:
      'Allowlisted filters: status, priority, assignedAdminId, createdFrom/To.',
  })
  list(@Query() query: AdminSupportListQueryDto) {
    return this.supportAdmin.listTickets(query);
  }

  @Get(':ticketId')
  @RequirePermissions(ADMIN_PERMISSIONS.SUPPORT_READ)
  @ApiOperation({
    summary: 'Support ticket detail',
    description: 'Includes public messages and internal notes.',
  })
  get(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Query() query: SupportListQueryDto,
  ) {
    return this.supportAdmin.getTicket(ticketId, query);
  }

  @Post(':ticketId/messages')
  @RequirePermissions(ADMIN_PERMISSIONS.SUPPORT_MANAGE)
  @ApiOperation({
    summary: 'Public Admin reply',
    description:
      'Persisted as SupportMessage authored by Admin account. displayName SpeedyGo Support. No AuditLog (message history is durable).',
  })
  reply(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() body: SupportMessageBodyDto,
  ) {
    return this.supportAdmin.reply(admin, ticketId, body.body);
  }

  @Post(':ticketId/internal-notes')
  @RequirePermissions(ADMIN_PERMISSIONS.SUPPORT_MANAGE)
  @ApiOperation({
    summary: 'Add internal note',
    description: 'Admin-only. Atomic AuditLog support.internal_note.',
  })
  addInternalNote(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() body: SupportMessageBodyDto,
  ) {
    return this.supportAdmin.addInternalNote(admin, ticketId, body.body);
  }

  @Post(':ticketId/assign')
  @RequirePermissions(ADMIN_PERMISSIONS.SUPPORT_MANAGE)
  @ApiOperation({
    summary: 'Assign or unassign Admin',
    description:
      'assignedAdminId must be AdminProfile with active Role and support.manage. Atomic audit. Null unassigns. Actor remains CurrentAdmin.',
  })
  assign(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() body: AdminSupportAssignDto,
  ) {
    return this.supportAdmin.assign(admin, ticketId, body.assignedAdminId);
  }

  @Post(':ticketId/priority')
  @RequirePermissions(ADMIN_PERMISSIONS.SUPPORT_MANAGE)
  @ApiOperation({
    summary: 'Set priority',
    description: 'LOW | NORMAL | HIGH. Atomic audit.',
  })
  setPriority(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() body: AdminSupportPriorityDto,
  ) {
    return this.supportAdmin.setPriority(admin, ticketId, body.priority);
  }

  @Post(':ticketId/start')
  @RequirePermissions(ADMIN_PERMISSIONS.SUPPORT_MANAGE)
  @ApiOperation({ summary: 'OPEN → IN_PROGRESS' })
  start(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ) {
    return this.supportAdmin.start(admin, ticketId);
  }

  @Post(':ticketId/wait-customer')
  @RequirePermissions(ADMIN_PERMISSIONS.SUPPORT_MANAGE)
  @ApiOperation({ summary: 'OPEN|IN_PROGRESS → WAITING_CUSTOMER' })
  waitCustomer(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ) {
    return this.supportAdmin.waitCustomer(admin, ticketId);
  }

  @Post(':ticketId/resolve')
  @RequirePermissions(ADMIN_PERMISSIONS.SUPPORT_MANAGE)
  @ApiOperation({ summary: 'Open-ish → RESOLVED' })
  resolve(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ) {
    return this.supportAdmin.resolve(admin, ticketId);
  }

  @Post(':ticketId/close')
  @RequirePermissions(ADMIN_PERMISSIONS.SUPPORT_MANAGE)
  @ApiOperation({ summary: 'RESOLVED → CLOSED' })
  close(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ) {
    return this.supportAdmin.close(admin, ticketId);
  }

  @Post(':ticketId/reopen')
  @RequirePermissions(ADMIN_PERMISSIONS.SUPPORT_MANAGE)
  @ApiOperation({ summary: 'RESOLVED|CLOSED → OPEN' })
  reopen(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ) {
    return this.supportAdmin.reopen(admin, ticketId);
  }
}
