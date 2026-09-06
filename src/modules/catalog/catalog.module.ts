import { Module } from '@nestjs/common';
import { MerchantsModule } from '../merchants/merchants.module';
import { CatalogService } from './application/catalog.service';
import { CustomerCatalogService } from './application/customer-catalog.service';
import { CatalogRepository } from './infrastructure/catalog.repository';
import { CustomerCatalogRepository } from './infrastructure/customer-catalog.repository';
import { CatalogController } from './presentation/http/catalog.controller';
import { CustomerCatalogController } from './presentation/http/customer-catalog.controller';

@Module({
  imports: [MerchantsModule],
  controllers: [CatalogController, CustomerCatalogController],
  providers: [
    CatalogRepository,
    CatalogService,
    CustomerCatalogRepository,
    CustomerCatalogService,
  ],
})
export class CatalogModule {}
