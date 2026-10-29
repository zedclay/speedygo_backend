import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import type { Request } from 'express';
import { map, type Observable } from 'rxjs';
import { resolveMoneyContract } from './money-contract';
import { projectMoneyPayload } from './money-response.projector';

function isBinaryHttpBody(data: unknown): boolean {
  return data instanceof StreamableFile || Buffer.isBuffer(data);
}

@Injectable()
export class MoneyContractResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const headers = (req?.headers ?? {}) as Record<
      string,
      string | string[] | undefined
    >;
    const contract = resolveMoneyContract(headers);
    return next.handle().pipe(
      map((data) => {
        // StreamableFile/Buffer must not be Object.entries-cloned. That keeps
        // Content-Type image/* while the body becomes {"options":...}.
        if (isBinaryHttpBody(data)) {
          return data;
        }
        return projectMoneyPayload(data, contract);
      }),
    );
  }
}
