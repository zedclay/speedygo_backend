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
import { AdminSettlementCommandsService } from '../../../application/admin-settlement-commands.service';
import { ADMIN_PERMISSIONS } from '../../../domain/admin-permissions';
import type { CurrentAdminContext } from '../../../domain/admin.types';
import { AdminQueryRepository } from '../../../infrastructure/admin-query.repository';
import { CurrentAdmin } from '../../decorators/current-admin.decorator';
import { AdminGuard } from '../../guards/admin.guard';
import {
  AdminSettlementListQueryDto,
  AdminEmptyBodyDto,
  AttachSettlementRefundLiabilityDto,
  OpenSettlementDraftDto,
} from '../dto/admin.dto';

@ApiTags('admin-settlements')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/settlements')
export class AdminSettlementController {
  constructor(
    private readonly queries: AdminQueryRepository,
    private readonly commands: AdminSettlementCommandsService,
  ) {}

  @Get()
  @RequirePermissions(ADMIN_PERMISSIONS.SETTLEMENTS_READ)
  @ApiOperation({ summary: 'List merchant settlements' })
  list(@Query() query: AdminSettlementListQueryDto) {
    return this.queries.listSettlements(query);
  }

  @Get(':id')
  @RequirePermissions(ADMIN_PERMISSIONS.SETTLEMENTS_READ)
  @ApiOperation({ summary: 'Settlement detail' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.queries.getSettlement(id);
  }

  @Post()
  @RequirePermissions(ADMIN_PERMISSIONS.SETTLEMENTS_MANAGE)
  @ApiOperation({
    summary: 'Open settlement draft',
    description: 'adminId injected from CurrentAdmin. No PAID transition.',
  })
  openDraft(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Body() body: OpenSettlementDraftDto,
  ) {
    return this.commands.openDraft(admin, body);
  }

  @Post(':id/build-sale-lines')
  @RequirePermissions(ADMIN_PERMISSIONS.SETTLEMENTS_MANAGE)
  @ApiOperation({ summary: 'Build SALE lines for draft settlement' })
  buildSaleLines(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _body: AdminEmptyBodyDto,
  ) {
    return this.commands.buildSaleLines(admin, id);
  }

  @Post(':id/refund-liability')
  @RequirePermissions(ADMIN_PERMISSIONS.SETTLEMENTS_MANAGE)
  @ApiOperation({ summary: 'Attach refund liability adjustment' })
  refundLiability(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AttachSettlementRefundLiabilityDto,
  ) {
    return this.commands.attachRefundLiability(admin, {
      settlementId: id,
      refundId: body.refundId,
      merchantLiabilityMinor: body.merchantLiabilityMinor,
    });
  }

  @Post(':id/finalize')
  @RequirePermissions(ADMIN_PERMISSIONS.SETTLEMENTS_MANAGE)
  @ApiOperation({
    summary: 'Finalize settlement',
    description: 'Does not mark PAID / paidAt.',
  })
  finalize(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _body: AdminEmptyBodyDto,
  ) {
    return this.commands.finalize(admin, id);
  }
}
