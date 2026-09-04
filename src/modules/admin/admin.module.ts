import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module';
import { CodModule } from '../cod/cod.module';
import { DriversModule } from '../drivers/drivers.module';
import { FinancialLedgerModule } from '../financial-ledger/financial-ledger.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { MerchantSettlementsModule } from '../merchant-settlements/merchant-settlements.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { RefundsModule } from '../refunds/refunds.module';
import { AdminAuditService } from './application/admin-audit.service';
import { AdminCodCommandsService } from './application/admin-cod-commands.service';
import { AdminDriverCommandsService } from './application/admin-driver-commands.service';
import { AdminMerchantCommandsService } from './application/admin-merchant-commands.service';
import { AdminProfileService } from './application/admin-profile.service';
import { AdminPromotionCommandsService } from './application/admin-promotion-commands.service';
import { AdminRefundCommandsService } from './application/admin-refund-commands.service';
import { AdminSettlementCommandsService } from './application/admin-settlement-commands.service';
import { AdminQueryRepository } from './infrastructure/admin-query.repository';
import { AdminGuard } from './presentation/guards/admin.guard';
import { AdminAuditController } from './presentation/http/controllers/admin-audit.controller';
import { AdminCodController } from './presentation/http/controllers/admin-cod.controller';
import { AdminCustomerController } from './presentation/http/controllers/admin-customer.controller';
import { AdminDriverController } from './presentation/http/controllers/admin-driver.controller';
import { AdminLedgerController } from './presentation/http/controllers/admin-ledger.controller';
import { AdminMeController } from './presentation/http/controllers/admin-me.controller';
import { AdminMerchantController } from './presentation/http/controllers/admin-merchant.controller';
import { AdminOrderController } from './presentation/http/controllers/admin-order.controller';
import { AdminPaymentController } from './presentation/http/controllers/admin-payment.controller';
import { AdminPromotionController } from './presentation/http/controllers/admin-promotion.controller';
import { AdminRefundController } from './presentation/http/controllers/admin-refund.controller';
import { AdminSettlementController } from './presentation/http/controllers/admin-settlement.controller';

@Module({
  imports: [
    AuthorizationModule,
    MerchantsModule,
    DriversModule,
    RefundsModule,
    CodModule,
    MerchantSettlementsModule,
    PromotionsModule,
    FinancialLedgerModule,
    NotificationsModule,
  ],
  controllers: [
    AdminMeController,
    AdminMerchantController,
    AdminDriverController,
    AdminCustomerController,
    AdminOrderController,
    AdminPaymentController,
    AdminRefundController,
    AdminCodController,
    AdminSettlementController,
    AdminPromotionController,
    AdminLedgerController,
    AdminAuditController,
  ],
  providers: [
    AdminProfileService,
    AdminAuditService,
    AdminQueryRepository,
    AdminMerchantCommandsService,
    AdminDriverCommandsService,
    AdminRefundCommandsService,
    AdminCodCommandsService,
    AdminSettlementCommandsService,
    AdminPromotionCommandsService,
    AdminGuard,
  ],
  exports: [AdminProfileService, AdminAuditService],
})
export class AdminModule {}
