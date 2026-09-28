import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { RealtimeEvent, RealtimeEvents } from './realtime-events';
import { RealtimeRoomFactory } from './realtime-room.factory';

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;

  attachServer(server: Server): void {
    this.server = server;
  }

  emitToUser(userId: string, event: RealtimeEvent, payload: unknown): void {
    this.emit(RealtimeRoomFactory.user(userId), event, payload);
  }

  emitToBusiness(businessId: string, event: RealtimeEvent, payload: unknown): void {
    this.emit(RealtimeRoomFactory.business(businessId), event, payload);
  }

  emitToQueue(queueId: string, event: RealtimeEvent, payload: unknown): void {
    this.emit(RealtimeRoomFactory.queue(queueId), event, payload);
  }

  emitQueueMutation(input: {
    event: RealtimeEvent;
    queueId: string;
    businessId?: string;
    userId?: string;
    payload: Record<string, unknown>;
  }): void {
    const payload = { ...input.payload, timestamp: new Date().toISOString() };
    if (input.userId) this.emitToUser(input.userId, input.event, this.publicPayload(payload));
    this.emitToQueue(input.queueId, input.event, this.publicPayload(payload));
    if (input.businessId)
      this.emitToBusiness(
        input.businessId,
        RealtimeEvents.queueUpdated,
        this.publicPayload(payload),
      );
    this.emitToQueue(input.queueId, RealtimeEvents.queueUpdated, this.publicPayload(payload));
  }

  private emit(room: string, event: RealtimeEvent, payload: unknown): void {
    if (!this.server) return;
    try {
      this.server.to(room).emit(event, payload);
    } catch (error: unknown) {
      this.logger.warn(`Realtime emit failed for ${event}: ${this.safeMessage(error)}`);
    }
  }

  private publicPayload(payload: Record<string, unknown>): Record<string, unknown> {
    return {
      queueId: payload.queueId,
      entryId: payload.entryId,
      queueNumber: payload.queueNumber,
      status: payload.status,
      timestamp: payload.timestamp,
    };
  }

  private safeMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
  }
}
