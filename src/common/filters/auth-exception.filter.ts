import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from '../errors/app.error';

export type ErrorEnvelope = {
  error: {
    code: string;
    message: string;
    changes?: string[];
    current?: {
      merchandiseSubtotalMinor: string;
      deliveryFeeMinor: string;
      customerTotalMinor: string;
    };
  };
};

@Catch()
export class AuthExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AuthExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof AppError) {
      const details = exception.details;
      response.status(exception.httpStatus).json({
        error: {
          code: exception.code,
          message: exception.message,
          ...(details && 'changes' in details
            ? {
                changes: details.changes as string[],
                current: details.current as {
                  merchandiseSubtotalMinor: string;
                  deliveryFeeMinor: string;
                  customerTotalMinor: string;
                },
              }
            : {}),
        },
      } satisfies ErrorEnvelope);
      return;
    }

    const multerCode =
      exception &&
      typeof exception === 'object' &&
      'code' in exception &&
      typeof exception.code === 'string'
        ? (exception as { code: string }).code
        : null;
    if (multerCode?.startsWith('LIMIT_')) {
      const tooLarge = multerCode === 'LIMIT_FILE_SIZE';
      response.status(HttpStatus.BAD_REQUEST).json({
        error: {
          code: tooLarge
            ? 'STORAGE_FILE_TOO_LARGE'
            : 'STORAGE_MALFORMED_MULTIPART',
          message: tooLarge
            ? 'File exceeds the maximum allowed size'
            : 'Multipart payload is invalid',
        },
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
      const lower = message.toLowerCase();
      if (
        status === 400 &&
        (lower.includes('unexpected field') ||
          lower.includes('too many') ||
          lower.includes('file too large') ||
          lower.includes('limits'))
      ) {
        const tooLarge = lower.includes('file too large');
        response.status(400).json({
          error: {
            code: tooLarge
              ? 'STORAGE_FILE_TOO_LARGE'
              : 'STORAGE_MALFORMED_MULTIPART',
            message: tooLarge
              ? 'File exceeds the maximum allowed size'
              : 'Multipart payload is invalid',
          },
        } satisfies ErrorEnvelope);
        return;
      }
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
