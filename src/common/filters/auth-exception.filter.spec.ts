import type { ArgumentsHost } from '@nestjs/common';
import { AppError } from '../errors/app.error';
import { AuthExceptionFilter } from './auth-exception.filter';

function run(exception: unknown) {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  new AuthExceptionFilter().catch(exception, host);
  return { status: status.mock.calls[0]?.[0], body: json.mock.calls[0]?.[0] };
}

describe('AuthExceptionFilter', () => {
  it('exposes the current opening-hours exception on a version conflict', () => {
    const current = { date: '2026-10-05', closed: true, version: 2 };
    const { status, body } = run(
      new AppError('OPENING_HOURS_EXCEPTION_VERSION_CONFLICT', 'stale', 409, {
        openingHoursException: current,
      }),
    );
    expect(status).toBe(409);
    expect(body).toEqual({
      error: {
        code: 'OPENING_HOURS_EXCEPTION_VERSION_CONFLICT',
        message: 'stale',
        openingHoursException: current,
      },
    });
  });

  it('exposes null when the conflicting date no longer has an exception', () => {
    const { body } = run(
      new AppError('OPENING_HOURS_EXCEPTION_VERSION_CONFLICT', 'stale', 409, {
        openingHoursException: null,
      }),
    );
    expect(body.error.openingHoursException).toBeNull();
  });

  it('does not leak detail keys outside the allow-list', () => {
    const { body } = run(
      new AppError('SOME_ERROR', 'x', 400, { internal: { secret: 'v' } }),
    );
    expect(body).toEqual({ error: { code: 'SOME_ERROR', message: 'x' } });
  });
});
