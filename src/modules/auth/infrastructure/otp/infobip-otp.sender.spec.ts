import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { InfobipOtpSender } from './infobip-otp.sender';
import { InfobipSmsError } from './infobip-sms.policy';

const CODE = '654321';
const TO = '+213780374715';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('InfobipOtpSender', () => {
  let dir: string;
  let keyFile: string;
  let fetchMock: jest.Mock;
  const realFetch = global.fetch;

  const senderWith = (overrides: Record<string, unknown> = {}) => {
    const values: Record<string, unknown> = {
      'auth.infobipBaseUrl': 'https://w4egyr.api.infobip.com',
      'auth.infobipApiKeyFile': keyFile,
      'auth.infobipSender': '447491163443',
      'auth.otpSmsDefaultLocale': 'fr',
      'auth.otpSmsTimeoutMs': 10_000,
      'auth.otpSmsAllowlist': TO,
      ...overrides,
    };
    return new InfobipOtpSender({
      get: (key: string, fallback?: unknown) =>
        key in values ? values[key] : fallback,
    } as never);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'infobip-otp-'));
    keyFile = join(dir, 'infobip-api-key');
    writeFileSync(keyFile, 'unit-infobip-key-not-for-production\n', {
      mode: 0o600,
    });
    fetchMock = jest.fn();
    global.fetch = fetchMock as never;
  });

  afterEach(() => {
    global.fetch = realFetch;
    rmSync(dir, { recursive: true, force: true });
  });

  const delivery = {
    channel: 'PHONE' as const,
    identifier: TO,
    purpose: 'AUTHENTICATE' as const,
    code: CODE,
  };

  it('POSTs /sms/3/messages with App auth, trial sender, and French payload', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        messages: [
          {
            messageId: 'mid-live',
            status: {
              groupName: 'PENDING',
              name: 'PENDING_ACCEPTED',
            },
          },
        ],
      }),
    );
    await senderWith().send(delivery);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://w4egyr.api.infobip.com/sms/3/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('App unit-infobip-key-not-for-production');
    expect(headers['content-type']).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({
      messages: [
        {
          sender: '447491163443',
          destinations: [{ to: '213780374715' }],
          content: {
            text: 'SpeedyGo: votre code est 654321. Valable 5 min.',
          },
        },
      ],
    });
  });

  it('rejects a provider REJECTED status inside HTTP 200', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        messages: [
          {
            messageId: 'mid-rej',
            status: { groupName: 'REJECTED', name: 'REJECTED_NETWORK' },
          },
        ],
      }),
    );
    await expect(senderWith().send(delivery)).rejects.toMatchObject({
      kind: 'rejected',
      providerStatus: 'REJECTED_NETWORK',
    });
  });

  it('fails closed on missing credential, 401, 403, 429, timeout, and 5xx', async () => {
    await expect(
      senderWith({ 'auth.infobipApiKeyFile': join(dir, 'missing') }).send(
        delivery,
      ),
    ).rejects.toMatchObject({ kind: 'not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(jsonResponse(401, {}));
    await expect(senderWith().send(delivery)).rejects.toMatchObject({
      kind: 'unauthorized',
      httpStatus: 401,
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(403, {}));
    await expect(senderWith().send(delivery)).rejects.toMatchObject({
      kind: 'unauthorized',
      httpStatus: 403,
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(429, {}));
    await expect(senderWith().send(delivery)).rejects.toMatchObject({
      kind: 'rate_limited',
    });
    fetchMock.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
    await expect(senderWith().send(delivery)).rejects.toMatchObject({
      kind: 'uncertain',
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(503, {}));
    await expect(senderWith().send(delivery)).rejects.toMatchObject({
      kind: 'uncertain',
    });
  });

  it('does not send outside the allowlist and never logs the OTP or API key', async () => {
    const logs: string[] = [];
    const spyLog = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation((m: unknown) => {
        logs.push(String(m));
      });
    const spyWarn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((m: unknown) => {
        logs.push(String(m));
      });
    await expect(
      senderWith().send({ ...delivery, identifier: '+213555000000' }),
    ).rejects.toMatchObject({ kind: 'not_allowed' });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        messages: [
          {
            messageId: 'mid-ok',
            status: { groupName: 'PENDING', name: 'PENDING_ACCEPTED' },
          },
        ],
      }),
    );
    await senderWith().send(delivery);
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(CODE);
    expect(serialized).not.toContain('unit-infobip-key');
    expect(serialized).not.toContain('Authorization');
    spyLog.mockRestore();
    spyWarn.mockRestore();
  });

  it('does not write a development OTP capture file', async () => {
    const captureDir = join(dir, 'otp-capture');
    mkdirSync(captureDir, { mode: 0o700 });
    process.env.SPEEDYGO_DEV_OTP_DIR = captureDir;
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        messages: [
          {
            messageId: 'mid-ok',
            status: { groupName: 'PENDING', name: 'PENDING_ACCEPTED' },
          },
        ],
      }),
    );
    await senderWith().send(delivery);
    expect(existsSync(join(captureDir, 'otp-last'))).toBe(false);
    delete process.env.SPEEDYGO_DEV_OTP_DIR;
  });

  it('does not automatically retry after an uncertain timeout', async () => {
    fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'));
    await expect(senderWith().send(delivery)).rejects.toBeInstanceOf(
      InfobipSmsError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
