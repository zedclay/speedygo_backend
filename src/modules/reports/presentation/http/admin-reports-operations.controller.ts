import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../authorization/require-permissions.decorator';
import { ADMIN_PERMISSIONS } from '../../../admin/domain/admin-permissions';
import { AdminGuard } from '../../../admin/presentation/guards/admin.guard';
import { ReportsQueryService } from '../../application/reports-query.service';
import {
  ReportListWindowQueryDto,
  ReportWindowQueryDto,
} from './dto/reports.dto';

@ApiTags('admin-reports-operations')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/reports/operations')
export class AdminReportsOperationsController {
  constructor(private readonly reports: ReportsQueryService) {}

  @Get('orders')
  @RequirePermissions(ADMIN_PERMISSIONS.REPORTS_READ)
  @ApiOperation({
    summary:
      'Operational Order summary (created cohort + completedAt completion cohort)',
  })
  orders(@Query() query: ReportWindowQueryDto) {
    return this.reports.getOrdersOperations(query);
  }

  @Get('deliveries')
  @RequirePermissions(ADMIN_PERMISSIONS.REPORTS_READ)
  @ApiOperation({
    summary: 'Operational Delivery summary (deliveredAt cohort)',
  })
  deliveries(@Query() query: ReportWindowQueryDto) {
    return this.reports.getDeliveriesOperations(query);
  }

  @Get('support')
  @RequirePermissions(ADMIN_PERMISSIONS.REPORTS_READ)
  @ApiOperation({
    summary: 'Support ticket counts by createdAt (no message bodies)',
  })
  support(@Query() query: ReportWindowQueryDto) {
    return this.reports.getSupportOperations(query);
  }

  @Get('ratings')
  @RequirePermissions(ADMIN_PERMISSIONS.REPORTS_READ)
  @ApiOperation({
    summary: 'Rating aggregates created in window (count/average; no comments)',
  })
  ratings(@Query() query: ReportWindowQueryDto) {
    return this.reports.getRatingsOperations(query);
  }

  @Get('drivers')
  @RequirePermissions(ADMIN_PERMISSIONS.REPORTS_READ)
  @ApiOperation({
    summary:
      'Paginated per-Driver completed delivery counts (historical RELEASED serving assignment)',
  })
  drivers(@Query() query: ReportListWindowQueryDto) {
    return this.reports.listDriverOperations(query);
  }
}
