import { Logger } from '@nestjs/common';
import {
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';

/**
 * Transport foundation only. No SpeedyGo business events are emitted yet.
 */
@WebSocketGateway({
  cors: { origin: true },
  namespace: '/realtime',
})
export class RealtimeGateway implements OnGatewayInit {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  afterInit(): void {
    this.logger.log('Realtime gateway ready (no business events registered)');
  }
}
