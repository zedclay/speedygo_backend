import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthError } from '../../modules/auth/domain/auth.errors';

export type ErrorEnvelope = {
  error: {
    code: string;
    message: string;
  };
};

@Catch()
export class AuthExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AuthExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof AuthError) {
      response.status(exception.httpStatus).json({
        error: { code: exception.code, message: exception.message },
      } satisfies ErrorEnvelope);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : typeof body === 'object' && body && 'message' in body
            ? Array.isArray(body.message)
              ? ((body as { message: string[] }).message[0] ?? 'Request failed')
              : String(body.message)
            : exception.message;
      response.status(status).json({
        error: {
          code: status === 400 ? 'VALIDATION_ERROR' : 'HTTP_ERROR',
          message,
        },
      } satisfies ErrorEnvelope);
      return;
    }

    this.logger.error(
      exception instanceof Error ? exception.message : 'Unhandled error',
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    } satisfies ErrorEnvelope);
  }
}
