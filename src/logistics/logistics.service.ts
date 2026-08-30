import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryStatus,
  DriverAvailability,
  Prisma,
  PromoApplicableService,
  RidePaymentMethod,
} from '@prisma/client';
import { randomInt } from 'crypto';
import { approximateRoadDistance } from '../common/utils/haversine.util';
import { generateSecureToken, hashToken } from '../common/utils/token.util';
import { GoogleMapsService } from '../integrations/google-maps/google-maps.service';
import { SmsService } from '../integrations/sms/sms.service';
import { PricingService } from '../pricing/pricing.service';
import { PrismaService } from '../prisma/prisma.service';
import { PromoService } from '../promo/promo.service';
import { ServiceAreasService } from '../service-areas/service-areas.service';
import { RedisService } from '../redis/redis.service';
import { WalletService } from '../wallet/wallet.service';
import { LogisticsDispatchService } from './logistics-dispatch.service';

const GEO_KEY = 'drivers:geo'; // shared with DispatchService/LogisticsDispatchService
const RECEIVER_OTP_LENGTH = 6;

interface StopInput {
  lat: number;
  lng: number;
  address: string;
}

@Injectable()
export class LogisticsService {
  private readonly logger = new Logger(LogisticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly maps: GoogleMapsService,
    private readonly pricing: PricingService,
    private readonly serviceAreas: ServiceAreasService,
    private readonly wallet: WalletService,
    private readonly sms: SmsService,
    private readonly dispatch: LogisticsDispatchService,
    private readonly promo: PromoService,
  ) {}

  async quote(params: {
    pickupLat: number;
    pickupLng: number;
    stops: StopInput[];
    vehicleType?: string;
  }) {
    const route = await this.getRouteDistance(params.pickupLat, params.pickupLng, params.stops);
    const areaCheck = await this.serviceAreas.validateLocation(params.pickupLat, params.pickupLng);

    if (params.vehicleType) {
      const tariff = await this.pricing.getActiveTariff(
        params.vehicleType,
        areaCheck.serviceArea?.id,
      );
      const estimatedFare = this.pricing.calculateFare(
        tariff,
        route.distanceKm,
        route.durationMinutes,
      );
      return {
        isServiceable: areaCheck.isServiceable,
        distanceKm: route.distanceKm,
        durationMinutes: route.durationMinutes,
        quotes: [
          {
            vehicleType: params.vehicleType,
            estimatedFare,
            currency: tariff.currency,
            recommended: true,
          },
        ],
      };
    }

    const tariffs = await this.pricing.listTariffs();
    const activeVehicleTypes = [
      ...new Set(tariffs.filter((t) => t.isActive).map((t) => t.vehicleType)),
    ];
    const quotes = await Promise.all(
      activeVehicleTypes.map(async (vehicleType) => {
        const tariff = await this.pricing.getActiveTariff(vehicleType, areaCheck.serviceArea?.id);
        return {
          vehicleType,
          estimatedFare: this.pricing.calculateFare(
            tariff,
            route.distanceKm,
            route.durationMinutes,
          ),
          currency: tariff.currency,
        };
      }),
    );
    quotes.sort((a, b) => a.estimatedFare.comparedTo(b.estimatedFare));

    return {
      isServiceable: areaCheck.isServiceable,
      distanceKm: route.distanceKm,
      durationMinutes: route.durationMinutes,
      quotes: quotes.map((q, i) => ({ ...q, recommended: i === 0 })),
    };
  }

  async createDelivery(
    senderId: string,
    dto: {
      pickupLat: number;
      pickupLng: number;
      pickupAddress: string;
      packageDescription: string;
      packageValue?: number;
      receiverName: string;
      receiverPhone: string;
      vehicleType: string;
      paymentMethod?: RidePaymentMethod;
      stops: StopInput[];
      promoCode?: string;
    },
    // Set only when booked through POST /business/{id}/deliveries/schedule
    // — the credit-limit check happens in BusinessService before this is
    // called (not here), to avoid a LogisticsModule <-> BusinessModule
    // circular import.
    businessId?: string,
  ) {
    const areaCheck = await this.serviceAreas.validateLocation(dto.pickupLat, dto.pickupLng);
    if (!areaCheck.isServiceable || !areaCheck.serviceArea) {
      throw new BadRequestException('Pickup location is outside our service area');
    }

    const serviceAreaId = areaCheck.serviceArea.id;
    const route = await this.getRouteDistance(dto.pickupLat, dto.pickupLng, dto.stops);
    const tariff = await this.pricing.getActiveTariff(dto.vehicleType, serviceAreaId);
    let estimatedFare = this.pricing.calculateFare(tariff, route.distanceKm, route.durationMinutes);

    // Business-billed deliveries aren't eligible for a retail promo code —
    // skip entirely when businessId is set, don't even attempt to validate.
    let appliedPromo: { promoId: string; discountAmount: Prisma.Decimal } | undefined;
    if (dto.promoCode && !businessId) {
      const result = await this.promo.validate(
        dto.promoCode,
        PromoApplicableService.DELIVERY,
        estimatedFare,
        senderId,
      );
      appliedPromo = { promoId: result.promoId, discountAmount: result.discountAmount };
      estimatedFare = result.finalAmount;
    }

    const trackingToken = generateSecureToken(16);
    const receiverOtp = this.generateOtp();

    const delivery = await this.prisma.$transaction(async (tx) => {
      const created = await tx.delivery.create({
        data: {
          senderId,
          businessId,
          vehicleType: dto.vehicleType,
          paymentMethod: dto.paymentMethod,
          pickupLat: dto.pickupLat,
          pickupLng: dto.pickupLng,
          pickupAddress: dto.pickupAddress,
          packageDescription: dto.packageDescription,
          packageValue: dto.packageValue,
          receiverName: dto.receiverName,
          receiverPhone: dto.receiverPhone,
          serviceAreaId,
          distanceKm: route.distanceKm,
          durationMinutes: route.durationMinutes,
          estimatedFare,
          trackingToken,
          receiverOtpHash: hashToken(receiverOtp),
          status: DeliveryStatus.REQUESTED,
        },
      });
      await tx.deliveryStop.createMany({
        data: dto.stops.map((stop, i) => ({
          deliveryId: created.id,
          sequence: i,
          lat: stop.lat,
          lng: stop.lng,
          address: stop.address,
        })),
      });
      return created;
    });

    if (appliedPromo) {
      await this.promo.recordRedemption(
        appliedPromo.promoId,
        senderId,
        PromoApplicableService.DELIVERY,
        delivery.id,
        appliedPromo.discountAmount,
      );
    }

    this.sms
      .sendMessage(
        dto.receiverPhone,
        `A Kilo delivery is on its way to you. Track it: /track/${trackingToken}. Your delivery code is ${receiverOtp} — share it with the driver on arrival.`,
      )
      .catch((err) => this.logger.warn(`Failed to send receiver tracking SMS: ${err}`));

    this.dispatch.startDispatch(delivery.id).catch((err) => {
      this.logger.error(`Dispatch failed to start for delivery ${delivery.id}: ${err}`);
    });

    return delivery;
  }

  async updateStops(userId: string, deliveryId: string, stops: StopInput[]) {
    const delivery = await this.findDeliveryForSender(userId, deliveryId);
    const editableStatuses: DeliveryStatus[] = [
      DeliveryStatus.REQUESTED,
      DeliveryStatus.DISPATCHING,
    ];
    if (!editableStatuses.includes(delivery.status)) {
      throw new BadRequestException(
        'Stops can only be edited before a driver has accepted the delivery',
      );
    }

    const route = await this.getRouteDistance(delivery.pickupLat, delivery.pickupLng, stops);
    const tariff = await this.pricing.getActiveTariff(
      delivery.vehicleType,
      delivery.serviceAreaId ?? undefined,
    );
    const estimatedFare = this.pricing.calculateFare(
      tariff,
      route.distanceKm,
      route.durationMinutes,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.deliveryStop.deleteMany({ where: { deliveryId } });
      await tx.deliveryStop.createMany({
        data: stops.map((stop, i) => ({
          deliveryId,
          sequence: i,
          lat: stop.lat,
          lng: stop.lng,
          address: stop.address,
        })),
      });
      await tx.delivery.update({
        where: { id: deliveryId },
        data: {
          distanceKm: route.distanceKm,
          durationMinutes: route.durationMinutes,
          estimatedFare,
        },
      });
    });

    return this.prisma.delivery.findUniqueOrThrow({
      where: { id: deliveryId },
      include: { stops: true },
    });
  }

  async getDelivery(userId: string, deliveryId: string) {
    return this.findDeliveryForParticipant(userId, deliveryId);
  }

  async listDeliveries(userId: string, role: 'SENDER' | 'DRIVER', take = 50, skip = 0) {
    const where: Prisma.DeliveryWhereInput =
      role === 'SENDER' ? { senderId: userId } : { driverId: userId };
    return this.prisma.delivery.findMany({
      where,
      include: { stops: { orderBy: { sequence: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  async cancelDelivery(userId: string, deliveryId: string, reason?: string) {
    const delivery = await this.findDeliveryForParticipant(userId, deliveryId);
    const cancellableStatuses: DeliveryStatus[] = [
      DeliveryStatus.REQUESTED,
      DeliveryStatus.DISPATCHING,
      DeliveryStatus.NO_DRIVERS_FOUND,
      DeliveryStatus.ACCEPTED,
    ];
    if (!cancellableStatuses.includes(delivery.status)) {
      throw new BadRequestException(`Cannot cancel a delivery in status ${delivery.status}`);
    }

    const driverCommitted = delivery.status === DeliveryStatus.ACCEPTED;
    const isSender = userId === delivery.senderId;
    let cancellationFee = 0;

    if (driverCommitted && isSender && delivery.driverId) {
      const tariff = await this.pricing.getActiveTariff(
        delivery.vehicleType,
        delivery.serviceAreaId ?? undefined,
      );
      const commissionRule = await this.pricing.getActiveCommissionRate(
        'DELIVERY',
        delivery.vehicleType,
      );
      const commissionAmount = tariff.cancellationFee.mul(commissionRule.rate);
      await this.wallet.payForDelivery(
        delivery.senderId,
        delivery.driverId,
        tariff.cancellationFee,
        commissionAmount,
        `delivery:${deliveryId}:cancellation`,
      );
      cancellationFee = tariff.cancellationFee.toNumber();
    }

    if (delivery.status === DeliveryStatus.DISPATCHING) {
      await this.dispatch.voidPendingOffers(deliveryId);
    }
    if (delivery.driverId) {
      await this.prisma.driverStatus.updateMany({
        where: { userId: delivery.driverId },
        data: { availability: DriverAvailability.ONLINE },
      });
    }

    return this.prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        status: DeliveryStatus.CANCELLED,
        cancelledById: userId,
        cancellationReason: reason,
        cancellationFee,
        cancelledAt: new Date(),
      },
    });
  }

  // Public — no auth. Deliberately excludes package value and fare (only
  // the sender needs to see money); includes a live driver position read
  // straight off the same Redis GEO set dispatch uses, same technique as
  // AdminOpsService's live-map.
  async trackDelivery(trackingToken: string) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { trackingToken },
      include: { stops: { orderBy: { sequence: 'asc' } }, driver: true },
    });
    if (!delivery) {
      throw new NotFoundException('Tracking link not found');
    }

    let driverPosition: { lat: number; lng: number } | null = null;
    if (delivery.driverId) {
      const [pos] = await this.redis.client.geopos(GEO_KEY, delivery.driverId);
      if (pos) {
        driverPosition = { lng: Number(pos[0]), lat: Number(pos[1]) };
      }
    }

    return {
      status: delivery.status,
      pickupAddress: delivery.pickupAddress,
      stops: delivery.stops.map((s) => ({ address: s.address, status: s.status })),
      driver: delivery.driver
        ? { firstName: delivery.driver.firstName, vehicleType: delivery.vehicleType }
        : null,
      driverPosition,
      requestedAt: delivery.requestedAt,
      completedAt: delivery.completedAt,
    };
  }

  async verifyReceiverOtp(trackingToken: string, code: string) {
    const delivery = await this.prisma.delivery.findUnique({ where: { trackingToken } });
    if (!delivery) {
      throw new NotFoundException('Tracking link not found');
    }
    if (!delivery.receiverOtpHash) {
      throw new BadRequestException('No verification code is pending for this delivery');
    }
    if (delivery.receiverOtpHash !== hashToken(code)) {
      throw new BadRequestException('Invalid code');
    }

    await this.prisma.delivery.update({
      where: { id: delivery.id },
      data: { receiverOtpVerifiedAt: new Date() },
    });
    return { verified: true };
  }

  async findDeliveryForParticipant(userId: string, deliveryId: string) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: { stops: { orderBy: { sequence: 'asc' } } },
    });
    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }
    if (delivery.senderId !== userId && delivery.driverId !== userId) {
      throw new ForbiddenException('You are not a participant on this delivery');
    }
    return delivery;
  }

  private async findDeliveryForSender(userId: string, deliveryId: string) {
    const delivery = await this.prisma.delivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }
    if (delivery.senderId !== userId) {
      throw new ForbiddenException('Only the sender can edit this delivery');
    }
    return delivery;
  }

  private generateOtp(): string {
    return randomInt(0, 10 ** RECEIVER_OTP_LENGTH)
      .toString()
      .padStart(RECEIVER_OTP_LENGTH, '0');
  }

  private async getRouteDistance(pickupLat: number, pickupLng: number, stops: StopInput[]) {
    let totalDistanceKm = 0;
    let totalDurationMinutes = 0;
    let legOriginLat = pickupLat;
    let legOriginLng = pickupLng;

    for (const stop of stops) {
      const leg = await this.getDistance(legOriginLat, legOriginLng, stop.lat, stop.lng);
      totalDistanceKm += leg.distanceKm;
      totalDurationMinutes += leg.durationMinutes;
      legOriginLat = stop.lat;
      legOriginLng = stop.lng;
    }

    return { distanceKm: totalDistanceKm, durationMinutes: totalDurationMinutes };
  }

  private async getDistance(
    originLat: number,
    originLng: number,
    destLat: number,
    destLng: number,
  ) {
    if (this.maps.isConfigured) {
      try {
        return await this.maps.distanceMatrix(originLat, originLng, destLat, destLng);
      } catch (err) {
        this.logger.warn(
          `Distance Matrix call failed, falling back to approximate distance: ${err}`,
        );
      }
    }
    return approximateRoadDistance(originLat, originLng, destLat, destLng);
  }
}
