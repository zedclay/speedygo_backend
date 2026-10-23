import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../authorization/require-permissions.decorator';
import { resolveWriteCentimes } from '../../../../../common/money/resolve-money-write';
import { CodFoundationService } from '../../../../cod/application/cod-foundation.service';
import { AdminCodCommandsService } from '../../../application/admin-cod-commands.service';
import { ADMIN_PERMISSIONS } from '../../../domain/admin-permissions';
import type { CurrentAdminContext } from '../../../domain/admin.types';
import { AdminQueryRepository } from '../../../infrastructure/admin-query.repository';
import { CurrentAdmin } from '../../decorators/current-admin.decorator';
import { AdminGuard } from '../../guards/admin.guard';
import {
  AdminCodDriverSummaryListQueryDto,
  AdminCodRemittanceListQueryDto,
  ConfirmCodRemittanceDto,
} from '../dto/admin.dto';

@ApiTags('admin-cod')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/cod')
export class AdminCodController {
  constructor(
    private readonly queries: AdminQueryRepository,
    private readonly commands: AdminCodCommandsService,
    private readonly cod: CodFoundationService,
  ) {}

  @Get('driver-summaries')
  @RequirePermissions(ADMIN_PERMISSIONS.COD_READ)
  @ApiOperation({
    summary: 'List COD custody summaries per driver',
    description:
      'Authoritative outstanding custody = SUM(COLLECTED) − SUM(confirmed allocations). Aggregated before pagination.',
  })
  listDriverSummaries(@Query() query: AdminCodDriverSummaryListQueryDto) {
    return this.cod.listAdminCodDriverSummaries(query);
  }

  @Get('driver-summaries/:driverId')
  @RequirePermissions(ADMIN_PERMISSIONS.COD_READ)
  @ApiOperation({ summary: 'COD custody summary for one driver' })
  getDriverSummary(@Param('driverId', ParseUUIDPipe) driverId: string) {
    return this.cod.getAdminCodDriverSummary(driverId);
  }

  @Get('remittances')
  @RequirePermissions(ADMIN_PERMISSIONS.COD_READ)
  @ApiOperation({ summary: 'List COD remittances' })
  listRemittances(@Query() query: AdminCodRemittanceListQueryDto) {
    return this.queries.listCodRemittances(query);
  }

  @Get('remittances/:id')
  @RequirePermissions(ADMIN_PERMISSIONS.COD_READ)
  @ApiOperation({ summary: 'COD remittance detail' })
  getRemittance(@Param('id', ParseUUIDPipe) id: string) {
    return this.queries.getCodRemittance(id);
  }

  @Post('remittances/:id/confirm')
  @RequirePermissions(ADMIN_PERMISSIONS.COD_REMITTANCE_CONFIRM)
  @ApiOperation({
    summary: 'Confirm COD remittance',
    description: 'Calls CodFoundationService.confirmCodRemittance.',
  })
  confirm(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ConfirmCodRemittanceDto,
    @Headers() headers: Record<string, unknown>,
  ) {
    const confirmedAmountMinor = resolveWriteCentimes({
      headers,
      minorField: body.confirmedAmountMinor,
      dzdField: body.confirmedAmount,
      fieldLabel: 'confirmedAmount',
    });
    return this.commands.confirmRemittance(admin, id, confirmedAmountMinor);
  }
}
