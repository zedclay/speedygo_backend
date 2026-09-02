import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AppError } from '../../../common/errors/app.error';
import { SessionService } from '../../auth/application/session.service';
import type { AuthenticatedPrincipal } from '../../auth/domain/auth.types';
import { TokenService } from '../../auth/infrastructure/token/token.service';
import { TrackingService } from '../application/tracking.service';
import {
  TRACKING_EVENT_ERROR,
  TRACKING_EVENT_LOCATION,
  TRACKING_EVENT_LOCATION_UPDATE,
  TRACKING_EVENT_STATUS,
  TRACKING_EVENT_SUBSCRIBE,
  TRACKING_EVENT_UNSUBSCRIBE,
  TRACKING_NAMESPACE,
} from '../domain/tracking.events';
import { TrackingError, trackingUnauthorized } from '../domain/tracking.errors';
import type {
  TrackingActor,
  TrackingSubscribeResult,
} from '../domain/tracking.types';

type SocketAck = {
  ok: boolean;
  error?: { code: string; message: string };
  snapshot?: TrackingSubscribeResult['snapshot'];
  recordedAt?: string;
};

type SocketSubscription = {
  actor: TrackingActor;
  room: string;
  orderId: string;
  merchantId?: string;
};

const principals = new WeakMap<Socket, AuthenticatedPrincipal>();
const subscriptions = new WeakMap<Socket, SocketSubscription>();
const expiryTimers = new WeakMap<Socket, ReturnType<typeof setTimeout>>();
const connected = new Set<Socket>();

@Injectable()
@WebSocketGateway({
  cors: { origin: true },
  namespace: TRACKING_NAMESPACE,
})
export class TrackingGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleInit,
    OnModuleDestroy
{
  @WebSocketServer()
  server!: Server;

  private revalidateTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly tracking: TrackingService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const every = this.config.get<number>(
      'tracking.authRevalidationIntervalMs',
      15_000,
    );
    this.revalidateTimer = setInterval(() => {
      void this.revalidateSubscriptions();
    }, every);
    this.revalidateTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.revalidateTimer) {
      clearInterval(this.revalidateTimer);
      this.revalidateTimer = null;
    }
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = extractHandshakeToken(client);
      const claims = this.tokens.verifyAccessToken(token);
      const principal = await this.sessions.assertPrincipal(
        claims.sub,
        claims.sid,
      );
      principals.set(client, principal);
      connected.add(client);
      this.scheduleAccessExpiry(client, claims.exp);
    } catch {
      client.emit(TRACKING_EVENT_ERROR, {
        code: 'AUTH_INVALID_TOKEN',
        message: 'Authentication required',
      });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.clearExpiry(client);
    principals.delete(client);
    subscriptions.delete(client);
    connected.delete(client);
  }

  @SubscribeMessage(TRACKING_EVENT_LOCATION_UPDATE)
  async onLocationUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
    ack?: (response: SocketAck) => void,
  ): Promise<SocketAck> {
    const response = await this.safeHandle(client, async (principal) => {
      const payload = asRecord(body);
      const result = await this.tracking.publishDriverLocation(
        principal.accountId,
        {
          latitude: payload.latitude,
          longitude: payload.longitude,
          accuracyMeters: payload.accuracyMeters,
        },
      );
      if (result.broadcast && result.rooms.length > 0) {
        const snapshot = await this.tracking.snapshotForAssignedDriver(
          principal.accountId,
        );
        const location = this.tracking.toBroadcastPayload(snapshot);
        if (location) {
          for (const room of result.rooms) {
            this.server.to(room).emit(TRACKING_EVENT_LOCATION, location);
          }
        }
      }
      return { ok: true, recordedAt: result.recordedAt };
    });
    ack?.(response);
    return response;
  }

  @SubscribeMessage(TRACKING_EVENT_SUBSCRIBE)
  async onSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
    ack?: (response: SocketAck) => void,
  ): Promise<SocketAck> {
    const response = await this.safeHandle(client, async (principal) => {
      const payload = asRecord(body);
      const authorized = await this.resolveSubscribe(principal, payload);
      await this.joinAuthorizedRoom(client, authorized);
      client.emit(TRACKING_EVENT_STATUS, {
        deliveryId: authorized.snapshot.deliveryId,
        status: authorized.snapshot.status,
        driverAssigned: authorized.snapshot.driverAssigned,
        assignedDriverId: authorized.snapshot.assignedDriverId,
        isStale: authorized.snapshot.isStale,
      });
      const live = this.tracking.toBroadcastPayload(authorized.snapshot);
      if (live) {
        client.emit(TRACKING_EVENT_LOCATION, live);
      }
      return { ok: true, snapshot: authorized.snapshot };
    });
    ack?.(response);
    return response;
  }

  @SubscribeMessage(TRACKING_EVENT_UNSUBSCRIBE)
  async onUnsubscribe(
    @ConnectedSocket() client: Socket,
    ack?: (response: SocketAck) => void,
  ): Promise<SocketAck> {
    await this.leaveCurrentRoom(client);
    const response = { ok: true };
    ack?.(response);
    return response;
  }

  private async reauthorize(
    principal: AuthenticatedPrincipal,
    sub: SocketSubscription,
  ): Promise<TrackingSubscribeResult> {
    if (sub.actor === 'merchant' && sub.merchantId) {
      return this.tracking.subscribeMerchant(
        principal.accountId,
        sub.merchantId,
        sub.orderId,
      );
    }
    if (sub.actor === 'customer') {
      return this.tracking.subscribeCustomer(principal.accountId, sub.orderId);
    }
    return this.tracking.subscribeAssignedDriver(principal.accountId);
  }

  private async resolveSubscribe(
    principal: AuthenticatedPrincipal,
    payload: Record<string, unknown>,
  ): Promise<TrackingSubscribeResult> {
    const orderId = typeof payload.orderId === 'string' ? payload.orderId : '';
    const merchantId =
      typeof payload.merchantId === 'string' ? payload.merchantId : '';
    if (merchantId && orderId) {
      return this.tracking.subscribeMerchant(
        principal.accountId,
        merchantId,
        orderId,
      );
    }
    if (orderId) {
      return this.tracking.subscribeCustomer(principal.accountId, orderId);
    }
    return this.tracking.subscribeAssignedDriver(principal.accountId);
  }

  private async joinAuthorizedRoom(
    client: Socket,
    authorized: TrackingSubscribeResult,
  ): Promise<void> {
    await this.leaveCurrentRoom(client);
    await client.join(authorized.room);
    subscriptions.set(client, {
      actor: authorized.actor,
      room: authorized.room,
      orderId: authorized.snapshot.orderId,
      merchantId: authorized.merchantId,
    });
  }

  private async leaveCurrentRoom(client: Socket): Promise<void> {
    const current = subscriptions.get(client);
    if (current) {
      await client.leave(current.room);
      subscriptions.delete(client);
    }
  }

  private async revalidateSubscriptions(): Promise<void> {
    for (const client of [...connected]) {
      try {
        const principal = await this.requirePrincipal(client);
        principals.set(client, principal);
        const sub = subscriptions.get(client);
        if (!sub) {
          continue;
        }
        const authorized = await this.reauthorize(principal, sub);
        if (authorized.room !== sub.room) {
          await this.joinAuthorizedRoom(client, authorized);
        }
      } catch (error) {
        if (isSessionFailure(error)) {
          client.emit(TRACKING_EVENT_ERROR, {
            code: 'AUTH_SESSION_REVOKED',
            message: 'Session is no longer valid',
          });
          client.disconnect(true);
          continue;
        }
        await this.leaveCurrentRoom(client);
        client.emit(TRACKING_EVENT_ERROR, {
          code: 'TRACKING_UNAUTHORIZED',
          message: 'Tracking is not available',
        });
      }
    }
  }

  private scheduleAccessExpiry(client: Socket, expSeconds: number): void {
    this.clearExpiry(client);
    const delayMs = expSeconds * 1000 - Date.now();
    if (delayMs <= 0) {
      client.disconnect(true);
      return;
    }
    const timer = setTimeout(() => {
      client.emit(TRACKING_EVENT_ERROR, {
        code: 'AUTH_INVALID_TOKEN',
        message: 'Access token expired',
      });
      client.disconnect(true);
    }, delayMs);
    timer.unref?.();
    expiryTimers.set(client, timer);
  }

  private clearExpiry(client: Socket): void {
    const timer = expiryTimers.get(client);
    if (timer) {
      clearTimeout(timer);
      expiryTimers.delete(client);
    }
  }

  private async requirePrincipal(
    client: Socket,
  ): Promise<AuthenticatedPrincipal> {
    const existing = principals.get(client);
    if (!existing) {
      throw trackingUnauthorized();
    }
    return this.sessions.assertPrincipal(
      existing.accountId,
      existing.sessionId,
    );
  }

  private async safeHandle(
    client: Socket,
    fn: (principal: AuthenticatedPrincipal) => Promise<SocketAck>,
  ): Promise<SocketAck> {
    try {
      const principal = await this.requirePrincipal(client);
      principals.set(client, principal);
      return await fn(principal);
    } catch (error) {
      const mapped = toAckError(error);
      client.emit(TRACKING_EVENT_ERROR, mapped.error);
      return mapped;
    }
  }
}

function extractHandshakeToken(client: Socket): string {
  const auth = client.handshake.auth as { token?: unknown };
  if (typeof auth.token === 'string' && auth.token.length > 0) {
    return auth.token.startsWith('Bearer ') ? auth.token.slice(7) : auth.token;
  }
  const header = client.handshake.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice(7);
  }
  throw trackingUnauthorized();
}

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }
  return body as Record<string, unknown>;
}

function toAckError(error: unknown): SocketAck {
  if (error instanceof TrackingError || error instanceof AppError) {
    return {
      ok: false,
      error: { code: error.code, message: error.message },
    };
  }
  return {
    ok: false,
    error: {
      code: 'TRACKING_UNAUTHORIZED',
      message: 'Tracking is not available',
    },
  };
}

function isSessionFailure(error: unknown): boolean {
  if (!(error instanceof AppError)) {
    return false;
  }
  return (
    error.code === 'AUTH_SESSION_REVOKED' ||
    error.code === 'AUTH_SESSION_EXPIRED' ||
    error.code === 'AUTH_INVALID_TOKEN' ||
    error.code === 'AUTH_ACCOUNT_SUSPENDED' ||
    error.code === 'AUTH_ACCOUNT_DISABLED'
  );
}
