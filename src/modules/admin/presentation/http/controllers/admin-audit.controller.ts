import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../authorization/require-permissions.decorator';
import { AdminAuditService } from '../../../application/admin-audit.service';
import { ADMIN_PERMISSIONS } from '../../../domain/admin-permissions';
import { AdminGuard } from '../../guards/admin.guard';
import { AdminAuditListQueryDto } from '../dto/admin.dto';

@ApiTags('admin-audit')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/audit')
export class AdminAuditController {
  constructor(private readonly audits: AdminAuditService) {}

  @Get()
  @RequirePermissions(ADMIN_PERMISSIONS.AUDIT_READ)
  @ApiOperation({
    summary: 'List audit logs',
    description: 'Immutable read. Allowlisted filters only.',
  })
  list(@Query() query: AdminAuditListQueryDto) {
    return this.audits.listAudits(query);
  }
}
