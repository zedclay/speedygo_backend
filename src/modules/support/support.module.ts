import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { SupportAdminService } from './application/support-admin.service';
import { SupportService } from './application/support.service';
import { SupportRepository } from './infrastructure/support.repository';
import { AdminSupportController } from './presentation/http/admin-support.controller';
import { CustomerSupportController } from './presentation/http/customer-support.controller';
import { DriverSupportController } from './presentation/http/driver-support.controller';
import { MerchantSupportController } from './presentation/http/merchant-support.controller';

@Module({
  imports: [AdminModule, MerchantsModule],
  controllers: [
    CustomerSupportController,
    DriverSupportController,
    MerchantSupportController,
    AdminSupportController,
  ],
  providers: [SupportRepository, SupportService, SupportAdminService],
  exports: [SupportService, SupportAdminService],
})
export class SupportModule {}
