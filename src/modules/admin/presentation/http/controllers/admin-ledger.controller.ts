import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../authorization/require-permissions.decorator';
import { FinancialLedgerService } from '../../../../financial-ledger/application/financial-ledger.service';
import { ADMIN_PERMISSIONS } from '../../../domain/admin-permissions';
import { AdminGuard } from '../../guards/admin.guard';
import { AdminLedgerListQueryDto } from '../dto/admin.dto';

@ApiTags('admin-ledger')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/ledger')
export class AdminLedgerController {
  constructor(private readonly ledger: FinancialLedgerService) {}

  @Get()
  @RequirePermissions(ADMIN_PERMISSIONS.LEDGER_READ)
  @ApiOperation({
    summary: 'List financial ledger entries',
    description: 'Read-only. No POST / ledger mutation routes.',
  })
  list(@Query() query: AdminLedgerListQueryDto) {
    return this.ledger.listEntries(query);
  }
}
