import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SessionService } from '../../../application/session.service';
import { authInvalidToken } from '../../../domain/auth.errors';
import type { AuthenticatedPrincipal } from '../../../domain/auth.types';
import { TokenService } from '../../../infrastructure/token/token.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
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
    request.principal = await this.sessions.assertPrincipal(
      claims.sub,
      claims.sid,
    );
    return true;
  }
}
