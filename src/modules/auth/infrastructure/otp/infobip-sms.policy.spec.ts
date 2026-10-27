import {
  buildInfobipHttpsUrl,
  buildInfobipSendBody,
  buildOtpSmsText,
  classifyInfobipSendHttp,
  gsm7PayloadLength,
  infobipAuthorizationHeader,
  infobipDestination,
  isGsm7SingleSegment,
  parseSmsAllowlist,
  sanitizeInfobipErrorBody,
} from './infobip-sms.policy';

describe('Infobip SMS policy', () => {
  it('builds v3 send URL, App authorization, and E.164 destination digits', () => {
    expect(buildInfobipHttpsUrl('https://w4egyr.api.infobip.com/', '/sms/3/messages')).toBe(
      'https://w4egyr.api.infobip.com/sms/3/messages',
    );
    expect(infobipAuthorizationHeader('unit-key')).toBe('App unit-key');
    expect(infobipDestination('+213780374715')).toBe('213780374715');
    const body = buildInfobipSendBody({
      sender: '447491163443',
      toE164: '+213780374715',
      text: 'SpeedyGo: votre code est 123456. Valable 5 min.',
    });
    expect(body).toEqual({
      messages: [
        {
          sender: '447491163443',
          destinations: [{ to: '213780374715' }],
          content: { text: 'SpeedyGo: votre code est 123456. Valable 5 min.' },
        },
      ],
    });
  });

  it('defaults OTP copy to French and keeps the live template in one GSM-7 segment', () => {
    expect(buildOtpSmsText('fr', '123456')).toBe(
      'SpeedyGo: votre code est 123456. Valable 5 min.',
    );
    expect(buildOtpSmsText('ar', '123456')).toContain('123456');
    expect(isGsm7SingleSegment(buildOtpSmsText('fr', '123456'))).toBe(true);
    expect(gsm7PayloadLength(buildOtpSmsText('fr', '123456'))).toBeLessThanOrEqual(
      160,
    );
  });

  it('treats HTTP 200 PENDING as accepted and REJECTED inside 200 as rejected', () => {
    expect(
      classifyInfobipSendHttp(200, {
        messages: [
          {
            messageId: 'mid-1',
            status: { groupId: 1, groupName: 'PENDING', name: 'PENDING_ACCEPTED' },
          },
        ],
      }),
    ).toEqual({
      kind: 'accepted',
      messageId: 'mid-1',
      statusName: 'PENDING_ACCEPTED',
    });
    expect(
      classifyInfobipSendHttp(200, {
        messages: [
          {
            messageId: 'mid-2',
            status: { groupId: 5, groupName: 'REJECTED', name: 'REJECTED_PREFIX_MISSING' },
          },
        ],
      }),
    ).toEqual({
      kind: 'rejected',
      messageId: 'mid-2',
      statusName: 'REJECTED_PREFIX_MISSING',
    });
  });

  it('classifies 401/403, 429, and 5xx without exposing bodies', () => {
    expect(classifyInfobipSendHttp(401, { error: 'nope' }).kind).toBe(
      'unauthorized',
    );
    expect(
      classifyInfobipSendHttp(403, {
        errorCode: 'E403',
        description: 'Insufficient permissions to access the requested resource.',
      }),
    ).toEqual({
      kind: 'unauthorized',
      messageId: null,
      statusName: 'E403',
    });
    expect(
      sanitizeInfobipErrorBody({
        errorCode: 'E403',
        description: 'Insufficient permissions to access the requested resource.',
        action: 'Repeat the request with new or different credentials.',
      }),
    ).toEqual({
      errorCode: 'E403',
      description: 'Insufficient permissions to access the requested resource.',
      action: 'Repeat the request with new or different credentials.',
    });
    expect(classifyInfobipSendHttp(429, {}).kind).toBe('rate_limited');
    expect(classifyInfobipSendHttp(503, {}).kind).toBe('uncertain');
  });

  it('parses an allowlist and treats empty as unrestricted', () => {
    expect(parseSmsAllowlist('')).toBeNull();
    expect(parseSmsAllowlist('+213780374715')).toEqual(
      new Set(['+213780374715']),
    );
  });
});
