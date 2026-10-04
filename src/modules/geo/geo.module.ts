import { Module } from '@nestjs/common';
import { GeoService } from './application/geo.service';
import { GeoRepository } from './infrastructure/geo.repository';
import { GeoController } from './presentation/http/geo.controller';

@Module({
  controllers: [GeoController],
  providers: [GeoRepository, GeoService],
  exports: [GeoService, GeoRepository],
})
export class GeoModule {}
