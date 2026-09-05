import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { SettingsService } from './application/settings.service';
import { SettingsRepository } from './infrastructure/settings.repository';
import { AdminSettingsController } from './presentation/http/admin-settings.controller';

@Module({
  imports: [AdminModule],
  controllers: [AdminSettingsController],
  providers: [SettingsRepository, SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
