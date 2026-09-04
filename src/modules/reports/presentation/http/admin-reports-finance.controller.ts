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

@ApiTags('admin-reports-finance')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/reports/finance')
export class AdminReportsFinanceController {
  constructor(private readonly reports: ReportsQueryService) {}

  @Get('completed-orders')
  @RequirePermissions(ADMIN_PERMISSIONS.REPORTS_FINANCE_READ)
  @ApiOperation({
    summary:
      'Completed-order commerce totals from immutable OrderFinancialSnapshot (completedAt cohort)',
  })
  completedOrders(@Query() query: ReportWindowQueryDto) {
    return this.reports.getCompletedOrdersFinance(query);
  }

  @Get('payments')
  @RequirePermissions(ADMIN_PERMISSIONS.REPORTS_FINANCE_READ)
  @ApiOperation({
    summary:
      'Payment SUCCEEDED during period via PaymentTransaction.processedAt (ELECTRONIC) or CodCollection.collectedAt (COD) — never Payment.updatedAt',
  })
  payments(@Query() query: ReportWindowQueryDto) {
    return this.reports.getPaymentsFinance(query);
  }

  @Get('refunds')
  @RequirePermissions(ADMIN_PERMISSIONS.REPORTS_FINANCE_READ)
  @ApiOperation({
    summary: 'REFUNDED customer amounts using Refund.completedAt',
  })
  refunds(@Query() query: ReportWindowQueryDto) {
    return this.reports.getRefundsFinance(query);
  }

  @Get('cod')
  @RequirePermissions(ADMIN_PERMISSIONS.REPORTS_FINANCE_READ)
  @ApiOperation({
    summary:
      'COD period flows + outstanding custody as-of `to` (history before to; custody ≠ earnings)',
  })
  cod(@Query() query: ReportWindowQueryDto) {
    return this.reports.getCodFinance(query);
  }

  @Get('driver-earnings')
  @RequirePermissions(ADMIN_PERMISSIONS.REPORTS_FINANCE_READ)
  @ApiOperation({
    summary: 'DriverEarning EARNED (unpaid) totals by DriverEarning.createdAt',
  })
  driverEarnings(@Query() query: ReportWindowQueryDto) {
    return this.reports.getDriverEarningsFinance(query);
  }

  @Get('settlements')
  @RequirePermissions(ADMIN_PERMISSIONS.REPORTS_FINANCE_READ)
  @ApiOperation({
    summary:
      'Settlement creation cohort (createdAt); current DRAFT/FINALIZED status of that cohort — not finalization-event time (no finalizedAt)',
  })
  settlements(@Query() query: ReportWindowQueryDto) {
    return this.reports.getSettlementsFinance(query);
  }

  @Get('promotions')
  @RequirePermissions(ADMIN_PERMISSIONS.REPORTS_FINANCE_READ)
  @ApiOperation({
    summary:
      'Merchant vs platform funded discounts from OrderFinancialSnapshot on completed Orders',
  })
  promotions(@Query() query: ReportWindowQueryDto) {
    return this.reports.getPromotionsFinance(query);
  }

  @Get('merchants')
  @RequirePermissions(ADMIN_PERMISSIONS.REPORTS_FINANCE_READ)
  @ApiOperation({
    summary:
      'Paginated per-Merchant completed-order OFS totals (neutral sort, not "top")',
  })
  merchants(@Query() query: ReportListWindowQueryDto) {
    return this.reports.listMerchantFinance(query);
  }
}
