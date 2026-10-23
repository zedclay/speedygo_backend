import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { map, type Observable } from 'rxjs';
import { resolveMoneyContract } from './money-contract';
import { projectMoneyPayload } from './money-response.projector';

@Injectable()
export class MoneyContractResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const headers = (req?.headers ?? {}) as Record<
      string,
      string | string[] | undefined
    >;
    const contract = resolveMoneyContract(headers);
    return next
      .handle()
      .pipe(map((data) => projectMoneyPayload(data, contract)));
  }
}
