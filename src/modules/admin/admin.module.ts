import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { AdminCommerceVerticalCommandsService } from '../catalog/application/admin-commerce-vertical-commands.service';
import { AdminCommerceVerticalController } from '../catalog/presentation/http/admin-commerce-vertical.controller';
import { AdminMerchantBranchStorefrontController } from '../catalog/presentation/http/admin-merchant-branch-storefront.controller';
import { CodModule } from '../cod/cod.module';
import { DeliveryPricingModule } from '../delivery-pricing/delivery-pricing.module';
import { DriversModule } from '../drivers/drivers.module';
import { FinancialLedgerModule } from '../financial-ledger/financial-ledger.module';
import { MatchingModule } from '../matching/matching.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { MerchantSettlementsModule } from '../merchant-settlements/merchant-settlements.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { RefundsModule } from '../refunds/refunds.module';
import { TrackingModule } from '../tracking/tracking.module';
import { AdminStorefrontCoverCommandsService } from './application/admin-storefront-cover-commands.service';
import { AdminProductImageCommandsService } from './application/admin-product-image-commands.service';
import { AdminProductImageController } from '../catalog/presentation/http/admin-product-image.controller';
import { AdminAuditService } from './application/admin-audit.service';
import { AdminCodCommandsService } from './application/admin-cod-commands.service';
import { AdminDocumentAccessService } from './application/admin-document-access.service';
import { AdminDriverCommandsService } from './application/admin-driver-commands.service';
import { AdminCustomerCommandsService } from './application/admin-customer-commands.service';
import { AdminCustomerNotesService } from './application/admin-customer-notes.service';
import { AdminMerchantCommandsService } from './application/admin-merchant-commands.service';
import { AdminOrderCommandsService } from './application/admin-order-commands.service';
import { AdminProfileService } from './application/admin-profile.service';
import { AdminPromotionCommandsService } from './application/admin-promotion-commands.service';
import { AdminRefundCommandsService } from './application/admin-refund-commands.service';
import { AdminNotificationsService } from './application/admin-notifications.service';
import { AdminNotificationTemplatesService } from './application/admin-notification-templates.service';
import { AdminSearchService } from './application/admin-search.service';
import { AdminSettlementCommandsService } from './application/admin-settlement-commands.service';
import { AdminDeliveryPricingRuleCommandsService } from '../delivery-pricing/application/admin-delivery-pricing-rule-commands.service';
import { AdminDeliveryZoneCommandsService } from '../delivery-pricing/application/admin-delivery-zone-commands.service';
import { AdminQueryRepository } from './infrastructure/admin-query.repository';
import { AdminSearchRepository } from './infrastructure/admin-search.repository';
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
import { AdminNotificationsController } from './presentation/http/controllers/admin-notifications.controller';
import { AdminNotificationTemplatesController } from './presentation/http/controllers/admin-notification-templates.controller';
import { AdminSearchController } from './presentation/http/controllers/admin-search.controller';
import { AdminSettlementController } from './presentation/http/controllers/admin-settlement.controller';
import { AdminDeliveryPricingRuleController } from '../delivery-pricing/presentation/http/controllers/admin-delivery-pricing-rule.controller';
import { AdminDeliveryZoneController } from '../delivery-pricing/presentation/http/controllers/admin-delivery-zone.controller';
import { AdminRbacService } from './application/admin-rbac.service';
import { AdminRbacRepository } from './infrastructure/admin-rbac.repository';
import { AdminAdminsController } from './presentation/http/controllers/admin-admins.controller';
import { AdminRolesController } from './presentation/http/controllers/admin-roles.controller';

@Module({
  imports: [
    AuthorizationModule,
    AuthModule,
    MerchantsModule,
    DriversModule,
    TrackingModule,
    MatchingModule,
    OrdersModule,
    RefundsModule,
    CodModule,
    MerchantSettlementsModule,
    PromotionsModule,
    FinancialLedgerModule,
    NotificationsModule,
    DeliveryPricingModule,
    CatalogModule,
  ],
  controllers: [
    AdminMeController,
    AdminSearchController,
    AdminNotificationsController,
    AdminNotificationTemplatesController,
    AdminAdminsController,
    AdminRolesController,
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
    AdminDeliveryZoneController,
    AdminDeliveryPricingRuleController,
    AdminCommerceVerticalController,
    AdminMerchantBranchStorefrontController,
    AdminProductImageController,
  ],
  providers: [
    AdminProfileService,
    AdminAuditService,
    AdminQueryRepository,
    AdminSearchRepository,
    AdminSearchService,
    AdminNotificationsService,
    AdminNotificationTemplatesService,
    AdminRbacRepository,
    AdminRbacService,
    AdminMerchantCommandsService,
    AdminOrderCommandsService,
    AdminCustomerCommandsService,
    AdminCustomerNotesService,
    AdminDriverCommandsService,
    AdminDocumentAccessService,
    AdminRefundCommandsService,
    AdminCodCommandsService,
    AdminSettlementCommandsService,
    AdminPromotionCommandsService,
    AdminDeliveryZoneCommandsService,
    AdminDeliveryPricingRuleCommandsService,
    AdminCommerceVerticalCommandsService,
    AdminStorefrontCoverCommandsService,
    AdminProductImageCommandsService,
    AdminGuard,
  ],
  exports: [AdminProfileService, AdminAuditService, AdminGuard],
})
export class AdminModule {}

