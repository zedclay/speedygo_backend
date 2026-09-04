import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { adminProfileRequired } from '../../domain/admin.errors';
import type { CurrentAdminContext } from '../../domain/admin.types';
import type { AdminAuthenticatedRequest } from '../guards/admin.guard';

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentAdminContext => {
    const request = ctx.switchToHttp().getRequest<AdminAuthenticatedRequest>();
    if (!request.admin) {
      throw adminProfileRequired();
    }
    return request.admin;
  },
);
