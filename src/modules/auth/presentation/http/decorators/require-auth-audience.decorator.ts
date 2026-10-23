import { SetMetadata } from '@nestjs/common';
import type { AuthAudience } from '../../../domain/auth-audience';

export const REQUIRED_AUTH_AUDIENCE_KEY = 'auth.requiredAudience';

/** Explicit route audience. Path prefix mapping is the default when omitted. */
export const RequireAuthAudience = (audience: AuthAudience) =>
  SetMetadata(REQUIRED_AUTH_AUDIENCE_KEY, audience);
