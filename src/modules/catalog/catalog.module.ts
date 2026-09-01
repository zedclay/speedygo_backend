import { Module } from '@nestjs/common';
import { MerchantsModule } from '../merchants/merchants.module';
import { CatalogService } from './application/catalog.service';
import { CatalogRepository } from './infrastructure/catalog.repository';
import { CatalogController } from './presentation/http/catalog.controller';

@Module({
  imports: [MerchantsModule],
  controllers: [CatalogController],
  providers: [CatalogRepository, CatalogService],
})
export class CatalogModule {}
