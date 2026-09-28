import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { Server } from 'socket.io';
import { BusinessesService } from '../businesses/businesses.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueueEntryStatus } from '@prisma/client';
import { RealtimeRoomFactory } from './realtime-room.factory';
import { RealtimeService } from './realtime.service';
import { SocketIoRedisAdapterService } from './socket-io-redis-adapter.service';
import { WebsocketAuthService } from './websocket-auth.service';
import { RealtimeSocket } from './types/realtime-socket.type';

type RoomPayload = { businessId?: string; queueId?: string };

@WebSocketGateway({
  namespace: '/realtime',
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',').map((origin) => origin.trim()) ?? false,
    credentials: true,
  },
})
export class QueueGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(QueueGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly auth: WebsocketAuthService,
    private readonly realtime: RealtimeService,
    private readonly prisma: PrismaService,
    private readonly businesses: BusinessesService,
    private readonly adapter: SocketIoRedisAdapterService,
  ) {}

  afterInit(server: Server): void {
    this.realtime.attachServer(server);
    void this.adapter.attach(server);
  }

  async handleConnection(socket: RealtimeSocket): Promise<void> {
    const user = await this.auth.authenticate(socket.handshake.auth?.token);
    if (!user) {
      socket.emit('error', {
        code: 'REALTIME_UNAUTHORIZED',
        message: 'Realtime authentication failed.',
      });
      socket.disconnect();
      return;
    }
    socket.data.user = user;
    await socket.join(RealtimeRoomFactory.user(user.id));
  }

  handleDisconnect(socket: RealtimeSocket): void {
    this.logger.debug(`Realtime socket disconnected: ${socket.id}`);
  }

  @SubscribeMessage('business:join')
  async joinBusiness(
    @ConnectedSocket() socket: RealtimeSocket,
    @MessageBody() payload: RoomPayload,
  ) {
    if (!payload || !isUUID(payload.businessId))
      return this.fail(socket, 'REALTIME_INVALID_PAYLOAD');
    const businessId = payload.businessId as string;
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, status: true },
    });
    if (!business || business.status !== 'ACTIVE')
      return this.fail(socket, 'REALTIME_RESOURCE_NOT_FOUND');
    const access = await this.businesses.getAccess(businessId, socket.data.user);
    if (!access.isAdmin && !access.isOwner && !access.membershipRole)
      return this.fail(socket, 'REALTIME_ACCESS_DENIED');
    await socket.join(RealtimeRoomFactory.business(businessId));
    return { event: 'business:joined', data: { businessId } };
  }

  @SubscribeMessage('queue:join-room')
  async joinQueue(@ConnectedSocket() socket: RealtimeSocket, @MessageBody() payload: RoomPayload) {
    if (!payload || !isUUID(payload.queueId)) return this.fail(socket, 'REALTIME_INVALID_PAYLOAD');
    const queueId = payload.queueId as string;
    const queue = await this.prisma.queue.findUnique({
      where: { id: queueId },
      select: { id: true, businessId: true },
    });
    if (!queue) return this.fail(socket, 'REALTIME_RESOURCE_NOT_FOUND');
    const access = await this.businesses.getAccess(queue.businessId, socket.data.user);
    const operator = access.isAdmin || access.isOwner || Boolean(access.membershipRole);
    const customerEntry = await this.prisma.queueEntry.findFirst({
      where: {
        queueId,
        customerId: socket.data.user.id,
        status: {
          in: [QueueEntryStatus.WAITING, QueueEntryStatus.CALLED, QueueEntryStatus.SERVING],
        },
      },
      select: { id: true },
    });
    if (!operator && !customerEntry) return this.fail(socket, 'REALTIME_ACCESS_DENIED');
    await socket.join(RealtimeRoomFactory.queue(queueId));
    return { event: 'queue:joined-room', data: { queueId } };
  }

  @SubscribeMessage('queue:leave-room')
  async leaveQueue(@ConnectedSocket() socket: RealtimeSocket, @MessageBody() payload: RoomPayload) {
    if (!payload || !isUUID(payload.queueId)) return this.fail(socket, 'REALTIME_INVALID_PAYLOAD');
    const queueId = payload.queueId as string;
    await socket.leave(RealtimeRoomFactory.queue(queueId));
    return { event: 'queue:left-room', data: { queueId } };
  }

  private fail(socket: RealtimeSocket, code: string) {
    const error = {
      code,
      message:
        code === 'REALTIME_ACCESS_DENIED'
          ? 'You do not have access to this resource.'
          : 'Realtime request failed.',
    };
    socket.emit('error', error);
    return { event: 'error', data: error };
  }
}
