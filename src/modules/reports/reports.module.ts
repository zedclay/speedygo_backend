import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { MerchantDailySummaryService } from './application/merchant-daily-summary.service';
import { MerchantSalesReportService } from './application/merchant-sales-report.service';
import { ReportsQueryService } from './application/reports-query.service';
import { MERCHANT_REPORTS_CLOCK } from './domain/merchant-sales-report.types';
import { AdminReportsFinanceController } from './presentation/http/admin-reports-finance.controller';
import { AdminReportsOperationsController } from './presentation/http/admin-reports-operations.controller';
import { MerchantReportsController } from './presentation/http/merchant-reports.controller';

@Module({
  imports: [AdminModule, MerchantsModule],
  controllers: [
    AdminReportsOperationsController,
    AdminReportsFinanceController,
    MerchantReportsController,
  ],
  providers: [
    ReportsQueryService,
    MerchantSalesReportService,
    MerchantDailySummaryService,
    { provide: MERCHANT_REPORTS_CLOCK, useValue: () => new Date() },
  ],
  exports: [ReportsQueryService],
})
export class ReportsModule {}
