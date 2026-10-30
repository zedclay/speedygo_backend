export const INFOBIP_SMS_SEND_PATH = '/sms/3/messages';
export const INFOBIP_SMS_REPORTS_PATH = '/sms/3/reports';

export type InfobipSmsErrorKind =
  | 'rejected'
  | 'unauthorized'
  | 'rate_limited'
  | 'uncertain'
  | 'not_configured'
  | 'not_allowed';

export class InfobipSmsError extends Error {
  constructor(
    readonly kind: InfobipSmsErrorKind,
    readonly httpStatus: number | null = null,
    readonly providerStatus: string | null = null,
  ) {
    super(`infobip_sms_${kind}`);
    this.name = 'InfobipSmsError';
  }
}

export function isUncertainInfobipOutcome(error: unknown): boolean {
  return error instanceof InfobipSmsError && error.kind === 'uncertain';
}

export function isDefiniteInfobipFailure(error: unknown): boolean {
  return error instanceof InfobipSmsError && error.kind !== 'uncertain';
}

export function infobipDestination(e164: string): string {
  return e164.trim().replace(/^\+/, '').replace(/\s+/g, '');
}

export function buildInfobipHttpsUrl(baseUrl: string, path: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed.startsWith('https://')) {
    throw new InfobipSmsError('not_configured');
  }
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${trimmed}${suffix}`;
}

export function infobipAuthorizationHeader(apiKey: string): string {
  return `App ${apiKey}`;
}

/**
 * OTP request DTO has no locale field. Default is French from
 * OTP_SMS_DEFAULT_LOCALE (not inferred from audience or country).
 */
export function buildOtpSmsText(locale: string, code: string): string {
  if (locale.trim().toLowerCase() === 'ar') {
    return `SpeedyGo: رمزك هو ${code}. صالح لمدة 5 دقائق.`;
  }
  return `SpeedyGo: votre code est ${code}. Valable 5 min.`;
}

const GSM7_BASIC = new Set(
  `@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà`.split(
    '',
  ),
);
const GSM7_EXT = new Set(['^', '{', '}', '\\', '[', '~', ']', '|', '€']);

export function gsm7PayloadLength(text: string): number {
  let units = 0;
  for (const char of text) {
    if (GSM7_EXT.has(char)) {
      units += 2;
    } else if (GSM7_BASIC.has(char)) {
      units += 1;
    } else {
      return Number.POSITIVE_INFINITY;
    }
  }
  return units;
}

export function isGsm7SingleSegment(text: string): boolean {
  return gsm7PayloadLength(text) <= 160;
}

export function buildInfobipSendBody(input: {
  sender: string;
  toE164: string;
  text: string;
}): {
  messages: Array<{
    sender: string;
    destinations: Array<{ to: string }>;
    content: { text: string };
  }>;
} {
  return {
    messages: [
      {
        sender: input.sender,
        destinations: [{ to: infobipDestination(input.toE164) }],
        content: { text: input.text },
      },
    ],
  };
}

export function parseSmsAllowlist(raw: string): Set<string> | null {
  const items = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (items.length === 0) {
    return null;
  }
  return new Set(items);
}

type InfobipStatus = {
  groupName?: string;
  name?: string;
};

type InfobipMessage = {
  messageId?: string;
  status?: InfobipStatus;
};

function readStatusName(status: InfobipStatus | undefined): string | null {
  if (typeof status?.name === 'string' && status.name) {
    return status.name;
  }
  if (typeof status?.groupName === 'string' && status.groupName) {
    return status.groupName;
  }
  return null;
}

function groupName(status: InfobipStatus | undefined): string {
  return typeof status?.groupName === 'string'
    ? status.groupName.toUpperCase()
    : '';
}

export function classifyInfobipMessageStatus(status: InfobipStatus | undefined): {
  kind: 'accepted' | 'rejected';
  statusName: string | null;
} {
  const group = groupName(status);
  const statusName = readStatusName(status);
  if (group === 'PENDING' || group === 'DELIVERED') {
    return { kind: 'accepted', statusName };
  }
  return { kind: 'rejected', statusName };
}

export function sanitizeInfobipErrorBody(body: unknown): {
  errorCode: string | null;
  description: string | null;
  action: string | null;
} {
  if (!body || typeof body !== 'object') {
    return { errorCode: null, description: null, action: null };
  }
  const rec = body as Record<string, unknown>;
  const requestError = rec.requestError as
    | { serviceException?: { messageId?: unknown; text?: unknown } }
    | undefined;
  const errorCode =
    typeof rec.errorCode === 'string' || typeof rec.errorCode === 'number'
      ? String(rec.errorCode)
      : typeof requestError?.serviceException?.messageId === 'string'
        ? requestError.serviceException.messageId
        : null;
  const description =
    typeof rec.description === 'string'
      ? rec.description
      : typeof requestError?.serviceException?.text === 'string'
        ? requestError.serviceException.text
        : null;
  const action = typeof rec.action === 'string' ? rec.action : null;
  return { errorCode, description, action };
}

function readHttpErrorName(body: unknown): string | null {
  return sanitizeInfobipErrorBody(body).errorCode;
}

export function classifyInfobipSendHttp(
  httpStatus: number,
  body: unknown,
): {
  kind: 'accepted' | 'rejected' | 'unauthorized' | 'rate_limited' | 'uncertain';
  messageId: string | null;
  statusName: string | null;
} {
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      kind: 'unauthorized',
      messageId: null,
      statusName: readHttpErrorName(body),
    };
  }
  if (httpStatus === 429) {
    return {
      kind: 'rate_limited',
      messageId: null,
      statusName: readHttpErrorName(body),
    };
  }
  if (httpStatus >= 500) {
    return { kind: 'uncertain', messageId: null, statusName: null };
  }
  if (httpStatus < 200 || httpStatus >= 300) {
    return { kind: 'rejected', messageId: null, statusName: null };
  }
  const messages = (body as { messages?: InfobipMessage[] } | null)?.messages;
  const first = Array.isArray(messages) ? messages[0] : undefined;
  const messageId =
    typeof first?.messageId === 'string' && first.messageId
      ? first.messageId
      : null;
  const classified = classifyInfobipMessageStatus(first?.status);
  if (classified.kind === 'accepted') {
    return {
      kind: 'accepted',
      messageId,
      statusName: classified.statusName,
    };
  }
  return {
    kind: 'rejected',
    messageId,
    statusName: classified.statusName,
  };
}

export function classifyInfobipReport(body: unknown): {
  delivered: boolean;
  statusName: string | null;
  messageId: string | null;
} {
  const results = (body as { results?: InfobipMessage[] } | null)?.results;
  const first = Array.isArray(results) ? results[0] : undefined;
  const statusName = readStatusName(first?.status);
  const messageId =
    typeof first?.messageId === 'string' && first.messageId
      ? first.messageId
      : null;
  const group = groupName(first?.status);
  const name = (statusName ?? '').toUpperCase();
  const delivered =
    group === 'DELIVERED' || name.includes('DELIVERED_TO_HANDSET');
  return { delivered, statusName, messageId };
}
