import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import { authenticateSocket } from './ws-auth.util';

function rideRoom(rideId: string): string {
  return `ride:${rideId}`;
}

function deliveryRoom(deliveryId: string): string {
  return `delivery:${deliveryId}`;
}

// Fixed namespace, per-ride rooms — same reasoning as DriverOffersGateway.
// Unlike that gateway, membership here isn't derivable purely from the
// authenticated identity (a rider has many rides), so the client explicitly
// subscribes to one — but only after the server verifies they're actually
// a participant on it, never trusting the rideId alone.
@Injectable()
@WebSocketGateway({ namespace: '/rides', cors: { origin: '*' } })
export class RideTrackingGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RideTrackingGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  handleConnection(client: Socket) {
    const payload = authenticateSocket(client, this.jwt);
    if (!payload) {
      client.disconnect(true);
      return;
    }
    client.data.userId = payload.sub;
  }

  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { rideId: string },
  ) {
    const userId: string | undefined = client.data.userId;
    if (!userId || !body?.rideId) {
      return { error: 'Not authenticated or missing rideId' };
    }

    const ride = await this.prisma.ride.findUnique({ where: { id: body.rideId } });
    if (!ride || (ride.riderId !== userId && ride.driverId !== userId)) {
      return { error: 'Not a participant on this ride' };
    }

    await client.join(rideRoom(body.rideId));
    return { subscribed: body.rideId };
  }

  // Package tracking: the sender (or the assigned driver) follows a
  // delivery the same way a rider follows a ride. Same namespace and
  // connection, separate room, same participant check.
  @SubscribeMessage('subscribe:delivery')
  async handleSubscribeDelivery(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { deliveryId: string },
  ) {
    const userId: string | undefined = client.data.userId;
    if (!userId || !body?.deliveryId) {
      return { error: 'Not authenticated or missing deliveryId' };
    }

    const delivery = await this.prisma.delivery.findUnique({ where: { id: body.deliveryId } });
    if (!delivery || (delivery.senderId !== userId && delivery.driverId !== userId)) {
      return { error: 'Not a participant on this delivery' };
    }

    await client.join(deliveryRoom(body.deliveryId));
    return { subscribed: body.deliveryId };
  }

  emitDeliveryLocation(deliveryId: string, location: { lat: number; lng: number }) {
    this.server.to(deliveryRoom(deliveryId)).emit('delivery:location', location);
  }

  emitDeliveryStatus(deliveryId: string, status: Record<string, unknown>) {
    this.server.to(deliveryRoom(deliveryId)).emit('delivery:status', status);
  }

  emitLocation(rideId: string, location: { lat: number; lng: number }) {
    this.server.to(rideRoom(rideId)).emit('location', location);
  }

  emitStatus(rideId: string, status: Record<string, unknown>) {
    this.server.to(rideRoom(rideId)).emit('status', status);
  }
}
