export const OTP_PURPOSES = ['AUTHENTICATE'] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

export const AUTH_CHANNELS = ['PHONE', 'EMAIL'] as const;
export type AuthChannel = (typeof AUTH_CHANNELS)[number];

export const ACCOUNT_STATUSES = ['ACTIVE', 'SUSPENDED', 'DISABLED'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const DEVICE_PLATFORMS = ['ios', 'android', 'web'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export type AuthenticatedPrincipal = {
  accountId: string;
  sessionId: string;
};

export type OtpChallenge = {
  codeHash: string;
  createdAt: string;
  expiresAt: string;
  attemptCount: number;
  requestCount: number;
  channel: AuthChannel;
  purpose: OtpPurpose;
};

export type DeviceMetadata = {
  deviceId?: string;
  platform: DevicePlatform;
  appVersion: string;
  deviceName?: string;
};

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
};

export type AccessTokenClaims = {
  sub: string;
  sid: string;
  typ: 'access';
  iat: number;
  exp: number;
};
