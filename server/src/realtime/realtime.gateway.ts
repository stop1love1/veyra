import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { OnModuleDestroy } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { RealtimeService } from './realtime.service';
import type { ChatPayload, EmotePayload, JoinPayload, StatePayload } from './realtime.types';

const ROOM = 'world';
const SNAPSHOT_MS = 100; // ~10 Hz presence broadcast

// CORS mirrors the HTTP allow-list (CLIENT_ORIGIN, default the local Next client).
const ORIGINS = (process.env.CLIENT_ORIGIN ?? 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim())
  .filter((o) => o.length > 0);

@WebSocketGateway({ cors: { origin: ORIGINS, credentials: true } })
export class RealtimeGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  @WebSocketServer() server!: Server;

  // socket.id -> playerId, and the reverse so a re-join from a new socket can
  // evict the player's previous socket (latest connection wins).
  private readonly socketToId = new Map<string, string>();
  private readonly idToSocketId = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly svc: RealtimeService) {}

  afterInit(): void {
    this.timer = setInterval(() => {
      this.server.to(ROOM).emit('snapshot', this.svc.snapshot());
    }, SNAPSHOT_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  handleConnection(): void {
    // No-op until the client emits `join` with its identity.
  }

  handleDisconnect(client: Socket): void {
    const id = this.socketToId.get(client.id);
    this.socketToId.delete(client.id);
    if (!id) return;
    // Only tear down presence if this socket is still the player's current one
    // (guards against a stale socket disconnecting after a reconnect replaced it).
    if (this.idToSocketId.get(id) === client.id) {
      this.idToSocketId.delete(id);
      this.svc.leave(id);
      this.server.to(ROOM).emit('leave', { id });
    }
  }

  @SubscribeMessage('join')
  onJoin(client: Socket, payload: JoinPayload): void {
    if (!payload || typeof payload.id !== 'string' || !payload.id) return;
    // Evict any previous socket holding this identity.
    const prev = this.idToSocketId.get(payload.id);
    if (prev && prev !== client.id) {
      const ps = this.server.sockets.sockets.get(prev);
      if (ps) ps.disconnect(true);
      this.socketToId.delete(prev);
    }
    this.socketToId.set(client.id, payload.id);
    this.idToSocketId.set(payload.id, client.id);
    void client.join(ROOM);
    this.svc.join(payload);
    // Ack with the current full snapshot so the joiner sees everyone immediately.
    client.emit('snapshot', this.svc.snapshot());
  }

  @SubscribeMessage('state')
  onState(client: Socket, payload: StatePayload): void {
    const id = this.socketToId.get(client.id);
    if (id) this.svc.updateState(id, payload);
  }

  @SubscribeMessage('claimSeat')
  onClaim(client: Socket, payload: { seatId?: string }): void {
    const id = this.socketToId.get(client.id);
    if (!id || !payload || typeof payload.seatId !== 'string') return;
    const ok = this.svc.claimSeat(id, payload.seatId);
    client.emit(ok ? 'seat:granted' : 'seat:denied', { seatId: payload.seatId });
  }

  @SubscribeMessage('releaseSeat')
  onRelease(client: Socket): void {
    const id = this.socketToId.get(client.id);
    if (id) this.svc.releaseSeat(id);
  }

  @SubscribeMessage('chat')
  onChat(client: Socket, payload: ChatPayload): void {
    const id = this.socketToId.get(client.id);
    if (!id || !payload) return;
    // Stored on presence; it rides out in the next snapshot (no extra broadcast).
    this.svc.setMessage(id, payload.text, Date.now());
  }

  @SubscribeMessage('emote')
  onEmote(client: Socket, payload: EmotePayload): void {
    const id = this.socketToId.get(client.id);
    if (!id || !payload) return;
    // Stored on presence; rides out in the next snapshot (same path as chat).
    this.svc.setEmote(id, payload.name, Date.now());
  }
}
