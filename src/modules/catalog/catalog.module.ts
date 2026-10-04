import { Module } from '@nestjs/common';
import {
  CHECKOUT_CLOCK,
  SystemCheckoutClock,
} from '../checkout/domain/checkout.clock';
import { MerchantsModule } from '../merchants/merchants.module';
import { CatalogService } from './application/catalog.service';
import { CustomerCatalogService } from './application/customer-catalog.service';
import { CatalogRepository } from './infrastructure/catalog.repository';
import { CommerceVerticalRepository } from './infrastructure/commerce-vertical.repository';
import { CustomerCatalogRepository } from './infrastructure/customer-catalog.repository';
import { MerchantBranchClassificationController } from './presentation/http/merchant-branch-classification.controller';
import { MerchantBranchClassificationService } from './application/merchant-branch-classification.service';
import { CatalogController } from './presentation/http/catalog.controller';
import { CustomerCatalogController } from './presentation/http/customer-catalog.controller';
import { MerchantProductImageController } from './presentation/http/merchant-product-image.controller';
import { MerchantProductImageService } from './application/merchant-product-image.service';
import { ProductImageRepository } from './infrastructure/product-image.repository';
import { ProductDuplicationService } from './application/product-duplication.service';
import { ProductDuplicationRepository } from './infrastructure/product-duplication.repository';

@Module({
  imports: [MerchantsModule],
  controllers: [
    MerchantBranchClassificationController,
    CatalogController,
    CustomerCatalogController,
    MerchantProductImageController,
  ],
  providers: [
    CatalogRepository,
    CatalogService,
    CustomerCatalogRepository,
    CustomerCatalogService,
    CommerceVerticalRepository,
    MerchantBranchClassificationService,
    ProductImageRepository,
    MerchantProductImageService,
    ProductDuplicationRepository,
    ProductDuplicationService,
    { provide: CHECKOUT_CLOCK, useClass: SystemCheckoutClock },
  ],
  exports: [
    CommerceVerticalRepository,
    CatalogRepository,
    ProductImageRepository,
    MerchantProductImageService,
  ],
})
export class CatalogModule {}
