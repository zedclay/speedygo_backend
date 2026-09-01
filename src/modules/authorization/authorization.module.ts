import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { PermissionService } from './permission.service';
import { PermissionsGuard } from './permissions.guard';

@Module({
  imports: [AuthModule],
  providers: [
    PermissionService,
    PermissionsGuard,
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [PermissionService, PermissionsGuard],
})
export class AuthorizationModule {}
