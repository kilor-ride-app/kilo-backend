import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { UserRole } from '@prisma/client';
import { Server, Socket } from 'socket.io';
import { authenticateSocket } from './ws-auth.util';

function driverRoom(driverId: string): string {
  return `driver:${driverId}`;
}

// Deliberately a fixed namespace with per-driver *rooms*, not a dynamic
// namespace-per-driver-id the way plan.md's `/drivers/{id}` literally reads
// — Socket.io namespaces are meant to be a small, fixed set declared at
// startup, not minted per entity; rooms are the idiomatic way to scope
// events to one recipient. A driver only ever joins their own room, derived
// from their authenticated identity — never a client-supplied ID.
@Injectable()
@WebSocketGateway({ namespace: '/drivers', cors: { origin: '*' } })
export class DriverOffersGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(DriverOffersGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private readonly jwt: JwtService) {}

  handleConnection(client: Socket) {
    const payload = authenticateSocket(client, this.jwt);
    if (!payload || payload.role !== UserRole.DRIVER) {
      client.disconnect(true);
      return;
    }
    client.data.driverId = payload.sub;
    client.join(driverRoom(payload.sub));
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Driver socket disconnected: ${client.data.driverId ?? 'unauthenticated'}`);
  }

  emitOffer(
    driverId: string,
    offer: {
      rideId: string;
      pickupAddress: string;
      dropoffAddress: string;
      estimatedFare: unknown;
      expiresAt: Date;
    },
  ) {
    this.server.to(driverRoom(driverId)).emit('ride:offer', offer);
  }

  emitOfferTaken(driverId: string, rideId: string) {
    this.server.to(driverRoom(driverId)).emit('ride:offer:taken', { rideId });
  }

  emitOfferCancelled(driverId: string, rideId: string) {
    this.server.to(driverRoom(driverId)).emit('ride:offer:cancelled', { rideId });
  }

  // Delivery-offer counterparts, sharing the same one-socket-per-driver
  // connection and room — a driver never needs a second WS connection just
  // because they've switched DriverStatus.serviceMode to LOGISTICS.
  emitDeliveryOffer(
    driverId: string,
    offer: {
      deliveryId: string;
      pickupAddress: string;
      packageDescription: string;
      estimatedFare: unknown;
      expiresAt: Date;
    },
  ) {
    this.server.to(driverRoom(driverId)).emit('delivery:offer', offer);
  }

  emitDeliveryOfferTaken(driverId: string, deliveryId: string) {
    this.server.to(driverRoom(driverId)).emit('delivery:offer:taken', { deliveryId });
  }

  emitDeliveryOfferCancelled(driverId: string, deliveryId: string) {
    this.server.to(driverRoom(driverId)).emit('delivery:offer:cancelled', { deliveryId });
  }
}
