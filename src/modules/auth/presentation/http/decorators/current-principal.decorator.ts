import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { authInvalidToken } from '../../../domain/auth.errors';
import type { AuthenticatedPrincipal } from '../../../domain/auth.types';

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedPrincipal => {
    const request = ctx.switchToHttp().getRequest<{
      principal?: AuthenticatedPrincipal;
    }>();
    if (!request.principal) {
      throw authInvalidToken();
    }
    return request.principal;
  },
);
