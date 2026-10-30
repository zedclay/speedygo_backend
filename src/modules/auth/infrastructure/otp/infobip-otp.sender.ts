import { readFileSync } from 'node:fs';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  OtpDelivery,
  OtpSenderPort,
} from '../../domain/ports/otp-sender.port';
import {
  InfobipSmsError,
  buildInfobipHttpsUrl,
  buildInfobipSendBody,
  buildOtpSmsText,
  classifyInfobipReport,
  classifyInfobipSendHttp,
  sanitizeInfobipErrorBody,
  infobipAuthorizationHeader,
  parseSmsAllowlist,
  INFOBIP_SMS_REPORTS_PATH,
  INFOBIP_SMS_SEND_PATH,
} from './infobip-sms.policy';

@Injectable()
export class InfobipOtpSender implements OtpSenderPort {
  private readonly logger = new Logger(InfobipOtpSender.name);
  private apiKey: string | null | undefined;

  constructor(private readonly config: ConfigService) {}

  send(delivery: OtpDelivery): Promise<void> {
    return this.sendSms(delivery);
  }

  async fetchDeliveryReport(messageId: string): Promise<{
    delivered: boolean;
    statusName: string | null;
    messageId: string | null;
  }> {
    const apiKey = this.loadApiKey();
    const baseUrl = this.baseUrl();
    const url = `${buildInfobipHttpsUrl(baseUrl, INFOBIP_SMS_REPORTS_PATH)}?messageId=${encodeURIComponent(messageId)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: {
          authorization: infobipAuthorizationHeader(apiKey),
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(this.timeoutMs()),
      });
    } catch {
      throw new InfobipSmsError('uncertain');
    }
    const body: unknown = await res.json().catch(() => null);
    if (res.status === 401 || res.status === 403) {
      throw new InfobipSmsError('unauthorized', res.status);
    }
    if (!res.ok) {
      throw new InfobipSmsError('rejected', res.status);
    }
    return classifyInfobipReport(body);
  }

  private async sendSms(delivery: OtpDelivery): Promise<void> {
    if (delivery.channel !== 'PHONE') {
      throw new InfobipSmsError('rejected', null, 'CHANNEL_UNSUPPORTED');
    }
    const apiKey = this.loadApiKey();
    const sender = this.config.get<string>('auth.infobipSender', '').trim();
    const baseUrl = this.baseUrl();
    if (!sender) {
      throw new InfobipSmsError('not_configured');
    }
    const allowlist = parseSmsAllowlist(
      this.config.get<string>('auth.otpSmsAllowlist', ''),
    );
    if (allowlist && !allowlist.has(delivery.identifier)) {
      throw new InfobipSmsError('not_allowed');
    }
    const locale = this.config.get<string>('auth.otpSmsDefaultLocale', 'fr');
    const text = buildOtpSmsText(locale, delivery.code);
    const url = buildInfobipHttpsUrl(baseUrl, INFOBIP_SMS_SEND_PATH);
    const payload = buildInfobipSendBody({
      sender,
      toE164: delivery.identifier,
      text,
    });
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: infobipAuthorizationHeader(apiKey),
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs()),
      });
    } catch {
      throw new InfobipSmsError('uncertain');
    }
    const body: unknown = await res.json().catch(() => null);
    const classified = classifyInfobipSendHttp(res.status, body);
    if (classified.kind === 'accepted') {
      this.logger.log(
        `otp sms accepted status=${classified.statusName ?? 'unknown'} messageId=${classified.messageId ?? 'none'}`,
      );
      return;
    }
    const sanitized = sanitizeInfobipErrorBody(body);
    this.logger.warn(
      `otp sms ${classified.kind} http=${res.status} status=${classified.statusName ?? 'none'} messageId=${classified.messageId ?? 'none'} errorCode=${sanitized.errorCode ?? 'none'} description=${sanitized.description ?? 'none'} action=${sanitized.action ?? 'none'}`,
    );
    throw new InfobipSmsError(
      classified.kind,
      res.status,
      classified.statusName,
    );
  }

  private loadApiKey(): string {
    if (this.apiKey !== undefined) {
      if (!this.apiKey) {
        throw new InfobipSmsError('not_configured');
      }
      return this.apiKey;
    }
    const file = this.config.get<string>('auth.infobipApiKeyFile', '').trim();
    if (!file) {
      this.apiKey = null;
      throw new InfobipSmsError('not_configured');
    }
    try {
      const raw = readFileSync(file, 'utf8').trim();
      if (!raw) {
        this.apiKey = null;
        throw new InfobipSmsError('not_configured');
      }
      this.apiKey = raw;
      return raw;
    } catch (error) {
      if (error instanceof InfobipSmsError) {
        throw error;
      }
      this.apiKey = null;
      throw new InfobipSmsError('not_configured');
    }
  }

  private baseUrl(): string {
    return this.config.get<string>('auth.infobipBaseUrl', '').trim();
  }

  private timeoutMs(): number {
    return this.config.get<number>('auth.otpSmsTimeoutMs', 10_000);
  }
}
