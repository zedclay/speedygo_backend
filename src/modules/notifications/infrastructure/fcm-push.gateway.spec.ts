import { createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FcmPushGateway } from './fcm-push.gateway';
import type { PushMessage } from '../domain/push.types';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const MESSAGE: PushMessage = {
  token: 'device-token-123456',
  platform: 'android',
  title: 'Nouvelle commande',
  body: 'Commande sgo_x',
  data: { type: 'MERCHANT_ORDER_CREATED', orderId: 'o' },
  collapseKey: 'o',
  ttlSeconds: 1800,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('FcmPushGateway', () => {
  let dir: string;
  let saFile: string;
  let fetchMock: jest.Mock;
  const realFetch = global.fetch;

  const gatewayWith = (overrides: Record<string, unknown> = {}) => {
    const values: Record<string, unknown> = {
      'push.provider': 'fcm',
      'push.fcmProjectId': 'speedygo-test',
      'push.fcmServiceAccountFile': saFile,
      nodeEnv: 'test',
      ...overrides,
    };
    return new FcmPushGateway({
      get: (key: string, fallback?: unknown) =>
        key in values ? values[key] : fallback,
    } as never);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fcm-gw-'));
    saFile = join(dir, 'sa.json');
    writeFileSync(
      saFile,
      JSON.stringify({
        type: 'service_account',
        project_id: 'speedygo-test',
        client_email: 'push@speedygo-test.iam.gserviceaccount.com',
        private_key: privateKey,
        token_uri: 'https://oauth2.googleapis.com/token',
      }),
    );
    fetchMock = jest.fn();
    global.fetch = fetchMock as never;
  });

  afterEach(() => {
    global.fetch = realFetch;
    rmSync(dir, { recursive: true, force: true });
  });

  it('is not configured when provider is disabled, file missing, or project mismatches', () => {
    expect(gatewayWith({ 'push.provider': 'disabled' }).isConfigured()).toBe(false);
    expect(
      gatewayWith({ 'push.fcmServiceAccountFile': join(dir, 'nope.json') }).isConfigured(),
    ).toBe(false);
    expect(gatewayWith({ 'push.fcmProjectId': 'other' }).isConfigured()).toBe(false);
    expect(gatewayWith().isConfigured()).toBe(true);
  });

  it('mints a signed RS256 JWT, sends with Bearer, and caches the access token', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'ya29.test', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, { name: 'projects/speedygo-test/messages/1' }))
      .mockResolvedValueOnce(jsonResponse(200, { name: 'projects/speedygo-test/messages/2' }));
    const gw = gatewayWith();

    await expect(gw.send(MESSAGE)).resolves.toEqual({
      kind: 'accepted',
      providerReference: 'fcm:projects/speedygo-test/messages/1',
    });
    await gw.send(MESSAGE);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(tokenUrl).toBe('https://oauth2.googleapis.com/token');
    const assertion = new URLSearchParams(tokenInit.body).get('assertion')!;
    const [h, c, s] = assertion.split('.');
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString()) as Record<string, unknown>;
    expect(claims.scope).toBe('https://www.googleapis.com/auth/firebase.messaging');
    expect(claims.iss).toBe('push@speedygo-test.iam.gserviceaccount.com');
    expect(
      createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url')),
    ).toBe(true);

    const [sendUrl, sendInit] = fetchMock.mock.calls[1] as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(sendUrl).toBe(
      'https://fcm.googleapis.com/v1/projects/speedygo-test/messages:send',
    );
    expect(sendInit.headers.authorization).toBe('Bearer ya29.test');
    expect((JSON.parse(sendInit.body) as { message: { token: string } }).message.token).toBe(
      MESSAGE.token,
    );
  });

  it('401 from FCM drops cached OAuth token and reports transient', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'old', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(401, { error: { status: 'UNAUTHENTICATED' } }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'new', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, { name: 'm/1' }));
    const gw = gatewayWith();
    await expect(gw.send(MESSAGE)).resolves.toEqual({
      kind: 'transient',
      code: 'UNAUTHENTICATED',
    });
    await gw.send(MESSAGE);
    const lastInit = fetchMock.mock.calls[3][1] as { headers: Record<string, string> };
    expect(lastInit.headers.authorization).toBe('Bearer new');
  });

  it('maps UNREGISTERED to invalid_token and network failure to transient', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 't', expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse(404, {
          error: {
            status: 'NOT_FOUND',
            details: [
              {
                '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
                errorCode: 'UNREGISTERED',
              },
            ],
          },
        }),
      )
      .mockRejectedValueOnce(new Error('ECONNRESET'));
    const gw = gatewayWith();
    await expect(gw.send(MESSAGE)).resolves.toEqual({
      kind: 'invalid_token',
      code: 'UNREGISTERED',
    });
    await expect(gw.send(MESSAGE)).resolves.toEqual({
      kind: 'transient',
      code: 'NETWORK',
    });
  });

  it('OAuth rejection is permanent; OAuth outage is transient', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: 'invalid_grant' }));
    await expect(gatewayWith().send(MESSAGE)).resolves.toEqual({
      kind: 'permanent',
      code: 'OAUTH_REJECTED',
    });
    fetchMock.mockRejectedValueOnce(new Error('ENOTFOUND'));
    await expect(gatewayWith().send(MESSAGE)).resolves.toEqual({
      kind: 'transient',
      code: 'OAUTH_UNAVAILABLE',
    });
  });

  it('ignores FCM_API_BASE_URL override in production', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 't', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, { name: 'm/1' }));
    await gatewayWith({
      nodeEnv: 'production',
      'push.fcmApiBaseUrl': 'http://127.0.0.1:9',
    }).send(MESSAGE);
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://fcm.googleapis.com/v1/projects/speedygo-test/messages:send',
    );
  });
});
