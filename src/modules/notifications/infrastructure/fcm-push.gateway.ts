import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { classifyFcmError, toFcmV1Body } from '../domain/push.policy';
import {
  PUSH_PROVIDER_FCM,
  type PushGateway,
  type PushMessage,
  type PushSendOutcome,
} from '../domain/push.types';

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const FCM_DEFAULT_BASE_URL = 'https://fcm.googleapis.com';
const ACCESS_TOKEN_SKEW_MS = 60_000;

type ServiceAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
};

class OAuthRejectedError extends Error {}

/**
 * FCM HTTP v1 sender (Android + iOS via APNs key uploaded to Firebase).
 * Credentials come only from the service-account file referenced by
 * FCM_SERVICE_ACCOUNT_FILE; values are never logged.
 */
@Injectable()
export class FcmPushGateway implements PushGateway {
  readonly provider = PUSH_PROVIDER_FCM;
  private readonly logger = new Logger(FcmPushGateway.name);
  private credentials: ServiceAccount | null | undefined;
  private accessToken: { value: string; expiresAtMs: number } | null = null;
  private accessTokenInFlight: Promise<string> | null = null;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return this.loadCredentials() !== null;
  }

  async send(message: PushMessage): Promise<PushSendOutcome> {
    const creds = this.loadCredentials();
    if (!creds) {
      return { kind: 'permanent', code: 'NOT_CONFIGURED' };
    }
    let bearer: string;
    try {
      bearer = await this.getAccessToken(creds);
    } catch (error) {
      if (error instanceof OAuthRejectedError) {
        return { kind: 'permanent', code: 'OAUTH_REJECTED' };
      }
      return { kind: 'transient', code: 'OAUTH_UNAVAILABLE' };
    }

    let res: Response;
    try {
      res = await fetch(
        `${this.baseUrl()}/v1/projects/${encodeURIComponent(creds.projectId)}/messages:send`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${bearer}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(toFcmV1Body(message, Date.now())),
          signal: AbortSignal.timeout(this.timeoutMs()),
        },
      );
    } catch {
      return { kind: 'transient', code: 'NETWORK' };
    }

    if (res.ok) {
      const json = (await res.json().catch(() => null)) as {
        name?: string;
      } | null;
      const name = typeof json?.name === 'string' ? json.name : 'accepted';
      return {
        kind: 'accepted',
        providerReference: `fcm:${name}`.slice(0, 255),
      };
    }

    const body: unknown = await res.json().catch(() => null);
    const outcome = classifyFcmError(res.status, body);
    if (res.status === 401 && outcome.code !== 'THIRD_PARTY_AUTH_ERROR') {
      // Expired/revoked OAuth token: drop the cache so the retry re-mints.
      this.accessToken = null;
      return { kind: 'transient', code: 'UNAUTHENTICATED' };
    }
    return outcome;
  }

  private loadCredentials(): ServiceAccount | null {
    if (this.credentials !== undefined) {
      return this.credentials;
    }
    this.credentials = this.readCredentials();
    return this.credentials;
  }

  private readCredentials(): ServiceAccount | null {
    const provider = this.config.get<string>('push.provider', 'disabled');
    if (provider !== PUSH_PROVIDER_FCM) {
      return null;
    }
    const projectId = this.config.get<string>('push.fcmProjectId', '');
    const file = this.config.get<string>('push.fcmServiceAccountFile', '');
    if (!projectId || !file) {
      this.logger.error(
        'PUSH_PROVIDER=fcm but FCM_PROJECT_ID or FCM_SERVICE_ACCOUNT_FILE is empty; Push stays SKIPPED_NOT_CONFIGURED',
      );
      return null;
    }
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    } catch {
      this.logger.error(
        'FCM service account file is unreadable or not JSON; Push stays SKIPPED_NOT_CONFIGURED',
      );
      return null;
    }
    const clientEmail = raw.client_email;
    const privateKey = raw.private_key;
    const fileProject = raw.project_id;
    const tokenUri =
      typeof raw.token_uri === 'string' ? raw.token_uri : GOOGLE_TOKEN_URI;
    if (
      raw.type !== 'service_account' ||
      typeof clientEmail !== 'string' ||
      typeof privateKey !== 'string' ||
      typeof fileProject !== 'string'
    ) {
      this.logger.error(
        'FCM service account file is missing required fields; Push stays SKIPPED_NOT_CONFIGURED',
      );
      return null;
    }
    if (fileProject !== projectId) {
      this.logger.error(
        'FCM service account project does not match FCM_PROJECT_ID; Push stays SKIPPED_NOT_CONFIGURED',
      );
      return null;
    }
    if (this.isProduction() && tokenUri !== GOOGLE_TOKEN_URI) {
      this.logger.error(
        'FCM service account token_uri must be the Google OAuth endpoint in production',
      );
      return null;
    }
    return { projectId, clientEmail, privateKey, tokenUri };
  }

  private async getAccessToken(creds: ServiceAccount): Promise<string> {
    const cached = this.accessToken;
    if (cached && cached.expiresAtMs - ACCESS_TOKEN_SKEW_MS > Date.now()) {
      return cached.value;
    }
    if (!this.accessTokenInFlight) {
      this.accessTokenInFlight = this.mintAccessToken(creds).finally(() => {
        this.accessTokenInFlight = null;
      });
    }
    return this.accessTokenInFlight;
  }

  private async mintAccessToken(creds: ServiceAccount): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
      iss: creds.clientEmail,
      scope: FCM_SCOPE,
      aud: creds.tokenUri,
      iat: nowSec,
      exp: nowSec + 3600,
    })}`;
    const signature = createSign('RSA-SHA256')
      .update(unsigned)
      .sign(creds.privateKey)
      .toString('base64url');

    const res = await fetch(creds.tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }).toString(),
      signal: AbortSignal.timeout(this.timeoutMs()),
    });
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      this.logger.error(`FCM OAuth token request rejected (HTTP ${res.status})`);
      throw new OAuthRejectedError();
    }
    if (!res.ok) {
      throw new Error(`FCM OAuth token request failed (HTTP ${res.status})`);
    }
    const json = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (typeof json.access_token !== 'string') {
      throw new OAuthRejectedError();
    }
    this.accessToken = {
      value: json.access_token,
      expiresAtMs: Date.now() + (json.expires_in ?? 3600) * 1000,
    };
    return json.access_token;
  }

  private baseUrl(): string {
    const override = this.config.get<string>('push.fcmApiBaseUrl', '');
    if (!override || this.isProduction()) {
      return FCM_DEFAULT_BASE_URL;
    }
    return override.replace(/\/+$/, '');
  }

  private timeoutMs(): number {
    return this.config.get<number>('push.requestTimeoutMs', 10_000);
  }

  private isProduction(): boolean {
    return this.config.get<string>('nodeEnv') === 'production';
  }
}
