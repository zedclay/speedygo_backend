import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthSecurityLogger } from '../auth/application/auth-security.logger';
import { authForbidden, authInvalidToken } from '../auth/domain/auth.errors';
import type { AuthenticatedPrincipal } from '../auth/domain/auth.types';
import { PermissionService } from './permission.service';
import { REQUIRED_PERMISSIONS_KEY } from './require-permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionService,
    private readonly security: AuthSecurityLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) {
      return true;
    }
    const request = context.switchToHttp().getRequest<{
      principal?: AuthenticatedPrincipal;
    }>();
    if (!request.principal) {
      throw authInvalidToken();
    }
    const codes = await this.permissions.codesForAccount(
      request.principal.accountId,
    );
    const allowed = required.every((code) => codes.includes(code));
    if (!allowed) {
      this.security.emit('authorization_denied', {
        accountId: request.principal.accountId,
        required: required.join(','),
      });
      throw authForbidden();
    }
    return true;
  }
}
