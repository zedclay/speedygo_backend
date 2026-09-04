import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { authInvalidToken } from '../../../auth/domain/auth.errors';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { AdminProfileService } from '../../application/admin-profile.service';
import type { CurrentAdminContext } from '../../domain/admin.types';

export type AdminAuthenticatedRequest = Request & {
  principal?: AuthenticatedPrincipal;
  admin?: CurrentAdminContext;
};

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly profiles: AdminProfileService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AdminAuthenticatedRequest>();
    if (!request.principal) {
      throw authInvalidToken();
    }
    request.admin = await this.profiles.resolveCurrentAdmin(
      request.principal.accountId,
      request.principal.sessionId,
    );
    return true;
  }
}
