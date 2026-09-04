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
import { RequirePermissions } from '../../../../authorization/require-permissions.decorator';
import { AdminRefundCommandsService } from '../../../application/admin-refund-commands.service';
import { ADMIN_PERMISSIONS } from '../../../domain/admin-permissions';
import type { CurrentAdminContext } from '../../../domain/admin.types';
import { AdminQueryRepository } from '../../../infrastructure/admin-query.repository';
import { CurrentAdmin } from '../../decorators/current-admin.decorator';
import { AdminGuard } from '../../guards/admin.guard';
import {
  AdminRefundListQueryDto,
  AdminRefundNoteDto,
  CreateAdminRefundDto,
} from '../dto/admin.dto';

@ApiTags('admin-refunds')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/refunds')
export class AdminRefundController {
  constructor(
    private readonly queries: AdminQueryRepository,
    private readonly commands: AdminRefundCommandsService,
  ) {}

  @Get()
  @RequirePermissions(ADMIN_PERMISSIONS.REFUNDS_READ)
  @ApiOperation({
    summary: 'List refunds',
    description: 'Includes internalNote for finance.',
  })
  list(@Query() query: AdminRefundListQueryDto) {
    return this.queries.listRefunds(query);
  }

  @Get(':id')
  @RequirePermissions(ADMIN_PERMISSIONS.REFUNDS_READ)
  @ApiOperation({ summary: 'Refund detail (includes internalNote)' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.queries.getRefund(id);
  }

  @Post()
  @RequirePermissions(ADMIN_PERMISSIONS.REFUNDS_MANAGE)
  @ApiOperation({
    summary: 'Create refund',
    description:
      'requestedByAdminId is injected from CurrentAdmin. Body adminId is rejected. MANUAL_COD / MANUAL_OTHER only.',
  })
  create(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Body() body: CreateAdminRefundDto,
  ) {
    return this.commands.create(admin, {
      orderId: body.orderId,
      amountMinor: body.amountMinor,
      reason: body.reason,
      refundMethod: body.method,
      internalNote: body.internalNote,
    });
  }

  @Post(':id/approve')
  @RequirePermissions(ADMIN_PERMISSIONS.REFUNDS_MANAGE)
  @ApiOperation({ summary: 'Authorize refund (approve)' })
  approve(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AdminRefundNoteDto,
  ) {
    return this.commands.approve(admin, id, body.internalNote);
  }

  @Post(':id/reject')
  @RequirePermissions(ADMIN_PERMISSIONS.REFUNDS_MANAGE)
  @ApiOperation({ summary: 'Reject refund' })
  reject(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AdminRefundNoteDto,
  ) {
    return this.commands.reject(admin, id, body.internalNote);
  }

  @Post(':id/confirm-manual')
  @RequirePermissions(ADMIN_PERMISSIONS.REFUNDS_MANAGE)
  @ApiOperation({
    summary: 'Confirm manual refund',
    description:
      'SOP: after authorize, finance completes off-platform remittance then confirms. No ORIGINAL_PAYMENT provider call.',
  })
  confirmManual(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AdminRefundNoteDto,
  ) {
    return this.commands.confirmManual(admin, id, body.internalNote);
  }
}
