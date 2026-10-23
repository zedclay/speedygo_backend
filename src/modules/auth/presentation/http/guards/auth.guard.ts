import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SessionService } from '../../../application/session.service';
import {
  authAudienceLegacyRejected,
  authAudienceMismatch,
  authInvalidToken,
} from '../../../domain/auth.errors';
import type { AuthAudience } from '../../../domain/auth-audience';
import { requiredAudienceForPath } from '../../../domain/route-audience';
import type { AuthenticatedPrincipal } from '../../../domain/auth.types';
import { SessionAudienceStore } from '../../../infrastructure/session-audience.store';
import { TokenService } from '../../../infrastructure/token/token.service';
import { REQUIRED_AUTH_AUDIENCE_KEY } from '../decorators/require-auth-audience.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly audiences: SessionAudienceStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { principal?: AuthenticatedPrincipal }>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw authInvalidToken();
    }
    const claims = this.tokens.verifyAccessToken(header.slice(7));
    const principal = await this.sessions.assertPrincipal(
      claims.sub,
      claims.sid,
    );
    this.assertAudience(request, context, claims.aud, principal.audience);
    request.principal = principal;
    return true;
  }

  private assertAudience(
    request: Request,
    context: ExecutionContext,
    tokenAudience: AuthAudience | undefined,
    sessionAudience: AuthAudience | null | undefined,
  ): void {
    if (!this.audiences.enforce()) {
      return;
    }
    if (!tokenAudience || !sessionAudience) {
      throw authAudienceLegacyRejected();
    }
    if (tokenAudience !== sessionAudience) {
      throw authInvalidToken();
    }
    const required =
      this.reflector.getAllAndOverride<AuthAudience | undefined>(
        REQUIRED_AUTH_AUDIENCE_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? requiredAudienceForPath(request.path || request.url || '');
    if (required && required !== sessionAudience) {
      throw authAudienceMismatch();
    }
  }
}
