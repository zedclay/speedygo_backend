import { Injectable, Logger } from '@nestjs/common';

export type AuthSecurityEvent =
  | 'otp_requested'
  | 'otp_verification_failed'
  | 'otp_verified'
  | 'session_created'
  | 'session_refreshed'
  | 'refresh_reuse_detected'
  | 'session_revoked'
  | 'all_sessions_revoked'
  | 'authentication_blocked_account_status'
  | 'authorization_denied';

@Injectable()
export class AuthSecurityLogger {
  private readonly logger = new Logger('AuthSecurity');

  emit(
    event: AuthSecurityEvent,
    fields: Record<string, string | number | boolean | null | undefined>,
  ): void {
    const safe: Record<string, string | number | boolean | null> = { event };
    for (const [key, value] of Object.entries(fields)) {
      if (
        /otp|code|token|secret|authorization|password|hash/i.test(key) &&
        key !== 'identifierHash'
      ) {
        continue;
      }
      safe[key] = value ?? null;
    }
    this.logger.log(JSON.stringify(safe));
  }
}
