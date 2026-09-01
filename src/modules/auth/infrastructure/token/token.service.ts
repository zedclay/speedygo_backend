import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import { authInvalidToken } from '../../domain/auth.errors';
import type { AccessTokenClaims } from '../../domain/auth.types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class TokenService {
  constructor(private readonly config: ConfigService) {}

  private accessSecret(): string {
    return this.config.get<string>('auth.jwtAccessSecret', '');
  }

  accessTtlSeconds(): number {
    return this.config.get<number>('auth.jwtAccessTtlSeconds', 900);
  }

  signAccessToken(accountId: string, sessionId: string): string {
    return jwt.sign({ sid: sessionId, typ: 'access' }, this.accessSecret(), {
      subject: accountId,
      expiresIn: this.accessTtlSeconds(),
    } as jwt.SignOptions);
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    try {
      const payload = jwt.verify(token, this.accessSecret());
      if (typeof payload !== 'object' || payload === null) {
        throw authInvalidToken();
      }
      const sub = payload.sub;
      const sid = (payload as { sid?: unknown }).sid;
      const typ = (payload as { typ?: unknown }).typ;
      if (
        typeof sub !== 'string' ||
        typeof sid !== 'string' ||
        typ !== 'access' ||
        typeof payload.iat !== 'number' ||
        typeof payload.exp !== 'number'
      ) {
        throw authInvalidToken();
      }
      return { sub, sid, typ: 'access', iat: payload.iat, exp: payload.exp };
    } catch (error) {
      if (error instanceof Error && error.name === 'AuthError') {
        throw error;
      }
      throw authInvalidToken();
    }
  }

  issueRefreshToken(sessionId: string): { token: string; hash: string } {
    const secret = randomBytes(32).toString('base64url');
    const token = `${sessionId}.${secret}`;
    return { token, hash: this.hashRefreshToken(token) };
  }

  parseRefreshToken(token: string): { sessionId: string; secret: string } {
    const dot = token.indexOf('.');
    if (dot <= 0) {
      throw authInvalidToken();
    }
    const sessionId = token.slice(0, dot);
    const secret = token.slice(dot + 1);
    if (!UUID_RE.test(sessionId) || secret.length < 16) {
      throw authInvalidToken();
    }
    return { sessionId, secret };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}
