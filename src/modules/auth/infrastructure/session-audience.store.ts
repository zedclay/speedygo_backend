import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../infrastructure/database/database.module';
import {
  isAuthAudience,
  type AuthAudience,
} from '../domain/auth-audience';
import { authMisconfigured } from '../domain/auth.errors';

@Injectable()
export class SessionAudienceStore {
  private columnReady: boolean | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  enforce(): boolean {
    return this.config.get<boolean>('auth.audienceEnforce', false) === true;
  }

  async bind(sessionId: string, audience: AuthAudience): Promise<void> {
    const ready = await this.ensureColumn();
    if (!ready) {
      if (this.enforce()) {
        throw authMisconfigured('Auth audience schema is not available');
      }
      return;
    }
    const client = this.prisma.getDb();
    const plan = client.raw.sql`
      UPDATE sessions
      SET auth_audience = ${audience}
      WHERE id = ${sessionId}::uuid
      RETURNING id
    `
      .returnsRow({ id: 'pg/uuid@1' })
      .build();
    await client.runtime().query(plan);
  }

  async read(sessionId: string): Promise<AuthAudience | null> {
    const ready = await this.ensureColumn();
    if (!ready) {
      return null;
    }
    const client = this.prisma.getDb();
    const plan = client.raw.sql`
      SELECT auth_audience
      FROM sessions
      WHERE id = ${sessionId}::uuid
    `
      .returnsRow({
        auth_audience: { codecId: 'sql/varchar@1', nullable: true },
      })
      .build();
    const rows = await client.runtime().query(plan);
    const raw = rows[0]?.auth_audience;
    return isAuthAudience(raw) ? raw : null;
  }

  private async ensureColumn(): Promise<boolean> {
    if (this.columnReady !== null) {
      return this.columnReady;
    }
    try {
      const client = this.prisma.getDb();
      const plan = client.raw.sql`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sessions'
          AND column_name = 'auth_audience'
      `
        .returnsRow({
          column_name: { codecId: 'sql/varchar@1', nullable: true },
        })
        .build();
      const rows = await client.runtime().query(plan);
      this.columnReady = rows.length > 0;
    } catch {
      this.columnReady = false;
    }
    if (!this.columnReady && this.enforce()) {
      throw authMisconfigured('Auth audience schema is not available');
    }
    return this.columnReady;
  }
}
