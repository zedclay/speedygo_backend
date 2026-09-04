import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { ReportsQueryService } from './application/reports-query.service';
import { AdminReportsFinanceController } from './presentation/http/admin-reports-finance.controller';
import { AdminReportsOperationsController } from './presentation/http/admin-reports-operations.controller';

@Module({
  imports: [AdminModule],
  controllers: [
    AdminReportsOperationsController,
    AdminReportsFinanceController,
  ],
  providers: [ReportsQueryService],
  exports: [ReportsQueryService],
})
export class ReportsModule {}
