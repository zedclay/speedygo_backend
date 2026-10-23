import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import { TokenService } from './token.service';

function tokens() {
  return new TokenService({
    get: (key: string, fallback?: unknown) => {
      if (key === 'auth.jwtAccessSecret')
        return 'unit-jwt-access-secret-32-chars!!';
      if (key === 'auth.jwtAccessTtlSeconds') return 900;
      return fallback;
    },
  } as ConfigService);
}

describe('TokenService', () => {
  it('signs access tokens with minimal claims', () => {
    const service = tokens();
    const jwt = service.signAccessToken('acct-1', 'sess-1');
    const claims = service.verifyAccessToken(jwt);
    expect(claims.sub).toBe('acct-1');
    expect(claims.sid).toBe('sess-1');
    expect(claims.typ).toBe('access');
    expect(claims.aud).toBeUndefined();
    expect(claims.exp - claims.iat).toBe(900);
  });

  it('binds an optional audience claim without granting privileges', () => {
    const service = tokens();
    const jwt = service.signAccessToken('acct-1', 'sess-1', 'DRIVER');
    const claims = service.verifyAccessToken(jwt);
    expect(claims.aud).toBe('DRIVER');
  });

  it('rejects a non-canonical audience claim', () => {
    const service = tokens();
    const forged = jwt.sign(
      { sid: 'sess-1', typ: 'access', aud: 'HACKER' },
      'unit-jwt-access-secret-32-chars!!',
      { subject: 'acct-1', expiresIn: 900 },
    );
    expect(() => service.verifyAccessToken(forged)).toThrow();
  });

  it('issues opaque refresh tokens and hashes them', () => {
    const service = tokens();
    const first = service.issueRefreshToken(
      '11111111-1111-7111-8111-111111111111',
    );
    expect(first.token).toContain('.');
    expect(first.hash).toHaveLength(64);
    expect(first.hash).not.toContain(first.token.split('.')[1]);
    const parsed = service.parseRefreshToken(first.token);
    expect(parsed.sessionId).toBe('11111111-1111-7111-8111-111111111111');
  });

  it('rejects malformed refresh tokens', () => {
    const service = tokens();
    expect(() => service.parseRefreshToken('not-a-token')).toThrow();
  });
});
