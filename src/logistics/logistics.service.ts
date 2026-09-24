import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import {
  AccountType,
  BusinessStatus,
  Delivery,
  DeliveryServiceType,
  DeliveryStatus,
  DriverAvailability,
  PackageSize,
  Prisma,
  PromoApplicableService,
  RidePaymentMethod,
  TariffServiceType,
} from '@prisma/client';
import { Queue } from 'bullmq';
import { randomInt } from 'crypto';
import { approximateRoadDistance } from '../common/utils/haversine.util';
import { generateSecureToken, hashToken } from '../common/utils/token.util';
import { trackingUrl } from '../common/utils/tracking-url.util';
import { DriverProfilesService } from '../drivers/driver-profiles.service';
import { GoogleMapsService } from '../integrations/google-maps/google-maps.service';
import { R2Service } from '../integrations/r2/r2.service';
import { SmsService } from '../integrations/sms/sms.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { PricingService } from '../pricing/pricing.service';
import { QuoteService } from '../pricing/quote.service';
import { PrismaService } from '../prisma/prisma.service';
import { PromoService } from '../promo/promo.service';
import { ServiceAreasService } from '../service-areas/service-areas.service';
import { RedisService } from '../redis/redis.service';
import { WalletService } from '../wallet/wallet.service';
import { LogisticsDispatchService } from './logistics-dispatch.service';

const GEO_KEY = 'drivers:geo'; // shared with DispatchService/LogisticsDispatchService
const RECEIVER_OTP_LENGTH = 6;

export const DELIVERY_SCHEDULE_QUEUE = 'delivery-schedule';

// A scheduled pickup must be far enough out to be worth scheduling, and
// close enough that pricing and driver supply are still meaningful.
const MIN_SCHEDULE_LEAD_MS = 30 * 60 * 1000;
const MAX_SCHEDULE_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;
// How long before scheduledFor dispatch starts looking for a driver.
const DISPATCH_LEAD_CONFIG_KEY = 'scheduledDispatchLeadMinutes';
const DEFAULT_DISPATCH_LEAD_MINUTES = 30;

const LIVE_DELIVERY_STATUSES: DeliveryStatus[] = [
  DeliveryStatus.ACCEPTED,
  DeliveryStatus.PICKED_UP,
];

interface StopInput {
  lat: number;
  lng: number;
  address: string;
}

// The two DeliveryServiceType values map one-to-one onto tariff service types.
function tariffServiceType(serviceType: DeliveryServiceType): TariffServiceType {
  return serviceType === DeliveryServiceType.FREIGHT
    ? TariffServiceType.FREIGHT
    : TariffServiceType.PACKAGE;
}

// Never hand a participant the receiver-OTP hash: it's a hash of a 6-digit
// code, so anyone holding it can brute-force the code in milliseconds —
// which would let a driver fake OTP proof of delivery, or show the sender
// a code the design says they never see. The R2 key and tracking token
// are internal too.
const PARTICIPANT_HIDDEN_FIELDS = ['receiverOtpHash', 'podFileKey', 'trackingToken'] as const;

function toParticipantView<T extends Delivery>(
  delivery: T,
): Omit<T, (typeof PARTICIPANT_HIDDEN_FIELDS)[number]> {
  const view = { ...delivery };
  for (const field of PARTICIPANT_HIDDEN_FIELDS) {
    delete view[field];
  }
  return view;
}

@Injectable()
export class LogisticsService {
  private readonly logger = new Logger(LogisticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly maps: GoogleMapsService,
    private readonly pricing: PricingService,
    private readonly quotes: QuoteService,
    private readonly serviceAreas: ServiceAreasService,
    private readonly wallet: WalletService,
    private readonly sms: SmsService,
    private readonly dispatch: LogisticsDispatchService,
    private readonly promo: PromoService,
    private readonly driverProfiles: DriverProfilesService,
    private readonly r2: R2Service,
    private readonly platformConfig: PlatformConfigService,
    private readonly config: ConfigService,
    @InjectQueue(DELIVERY_SCHEDULE_QUEUE) private readonly scheduleQueue: Queue,
  ) {}

  // Every vehicle option for PACKAGE (bike/tricycle/car) or FREIGHT
  // (van/truck), cheapest marked recommended — or just `vehicleType`.
  async quote(
    params: {
      pickupLat: number;
      pickupLng: number;
      stops: StopInput[];
      vehicleType?: string;
      serviceType?: DeliveryServiceType;
      promoCode?: string;
    },
    userId?: string,
  ) {
    const route = await this.getRouteDistance(params.pickupLat, params.pickupLng, params.stops);
    const areaCheck = await this.serviceAreas.validateLocation(params.pickupLat, params.pickupLng);

    const { quotes, promo } = await this.quotes.quoteVehicles({
      serviceType: tariffServiceType(params.serviceType ?? DeliveryServiceType.PACKAGE),
      serviceAreaId: areaCheck.serviceArea?.id,
      distanceKm: route.distanceKm,
      durationMinutes: route.durationMinutes,
      vehicleType: params.vehicleType,
      promo:
        params.promoCode && userId
          ? { code: params.promoCode, userId, service: PromoApplicableService.DELIVERY }
          : undefined,
    });

    return {
      isServiceable: areaCheck.isServiceable,
      distanceKm: route.distanceKm,
      durationMinutes: route.durationMinutes,
      quotes,
      promo:
        params.promoCode && !userId
          ? {
              code: params.promoCode.toUpperCase(),
              applied: false,
              message: 'Sign in to apply a promo code',
            }
          : promo,
    };
  }

  async createDelivery(
    senderId: string,
    dto: {
      pickupLat: number;
      pickupLng: number;
      pickupAddress: string;
      serviceType?: DeliveryServiceType;
      packageDescription: string;
      packageValue?: number;
      weightKg?: number;
      packageSize?: PackageSize;
      isFragile?: boolean;
      deliveryNotes?: string;
      receiverName: string;
      receiverPhone: string;
      vehicleType: string;
      paymentMethod?: RidePaymentMethod;
      stops: StopInput[];
      promoCode?: string;
      scheduledFor?: Date;
    },
    // Set only when booked through POST /business/{id}/deliveries/schedule
    // — the credit-limit check happens in BusinessService before this is
    // called (not here), to avoid a LogisticsModule <-> BusinessModule
    // circular import.
    businessId?: string,
  ) {
    let paymentMethod = dto.paymentMethod ?? RidePaymentMethod.WALLET;
    // "Business Invoice" picked in the mobile app, as opposed to the
    // business bulk-booking route (which passes businessId and has already
    // checked the credit limit itself).
    const billedFromApp = !businessId && paymentMethod === RidePaymentMethod.BUSINESS_INVOICE;
    if (billedFromApp) {
      businessId = await this.resolveSenderBusiness(senderId);
    } else if (businessId) {
      paymentMethod = RidePaymentMethod.BUSINESS_INVOICE;
    }

    const scheduledFor = dto.scheduledFor ? new Date(dto.scheduledFor) : undefined;
    if (scheduledFor) {
      this.assertSchedulable(scheduledFor);
    }

    const areaCheck = await this.serviceAreas.validateLocation(dto.pickupLat, dto.pickupLng);
    if (!areaCheck.isServiceable || !areaCheck.serviceArea) {
      throw new BadRequestException('Pickup location is outside our service area');
    }

    const serviceType = dto.serviceType ?? DeliveryServiceType.PACKAGE;
    const serviceAreaId = areaCheck.serviceArea.id;
    const route = await this.getRouteDistance(dto.pickupLat, dto.pickupLng, dto.stops);
    const tariff = await this.pricing.getActiveTariff(
      dto.vehicleType,
      serviceAreaId,
      tariffServiceType(serviceType),
    );
    const subtotal = this.pricing.calculateFare(tariff, route.distanceKm, route.durationMinutes);

    // Business-billed deliveries aren't eligible for a retail promo code —
    // skip entirely when businessId is set, don't even attempt to validate.
    let promoId: string | undefined;
    let discount = new Prisma.Decimal(0);
    if (dto.promoCode && !businessId) {
      const result = await this.promo.validate(
        dto.promoCode,
        PromoApplicableService.DELIVERY,
        subtotal,
        senderId,
      );
      promoId = result.promoId;
      discount = result.discountAmount;
    }
    const fare = await this.pricing.buildFareBreakdown(subtotal, discount);

    if (billedFromApp) {
      await this.assertWithinCreditLimit(businessId!, fare.total);
    }

    const trackingToken = generateSecureToken(16);
    const receiverOtp = this.generateOtp();

    const delivery = await this.prisma.$transaction(async (tx) => {
      const created = await tx.delivery.create({
        data: {
          senderId,
          businessId,
          serviceType,
          vehicleType: dto.vehicleType,
          paymentMethod,
          pickupLat: dto.pickupLat,
          pickupLng: dto.pickupLng,
          pickupAddress: dto.pickupAddress,
          packageDescription: dto.packageDescription,
          packageValue: dto.packageValue,
          weightKg: dto.weightKg,
          packageSize: dto.packageSize,
          isFragile: dto.isFragile ?? false,
          deliveryNotes: dto.deliveryNotes?.trim() || null,
          receiverName: dto.receiverName,
          receiverPhone: dto.receiverPhone,
          serviceAreaId,
          distanceKm: route.distanceKm,
          durationMinutes: route.durationMinutes,
          subtotalFare: fare.subtotal,
          promoDiscount: fare.promoDiscount,
          taxAmount: fare.tax,
          estimatedFare: fare.total,
          trackingToken,
          receiverOtpHash: hashToken(receiverOtp),
          scheduledFor,
          status: scheduledFor ? DeliveryStatus.SCHEDULED : DeliveryStatus.REQUESTED,
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

    if (promoId) {
      await this.promo.recordRedemption(
        promoId,
        senderId,
        PromoApplicableService.DELIVERY,
        delivery.id,
        fare.promoDiscount,
      );
    }

    const trackLink = trackingUrl(this.config, trackingToken);
    const when = scheduledFor
      ? ` scheduled for ${scheduledFor.toLocaleString('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' })}`
      : ' on its way to you';
    this.sms
      .sendMessage(
        dto.receiverPhone,
        `A Kilo delivery is${when}. Track it: ${trackLink}. Your delivery code is ${receiverOtp} — share it with the driver on arrival.`,
      )
      .catch((err) => this.logger.warn(`Failed to send receiver tracking SMS: ${err}`));

    if (scheduledFor) {
      await this.enqueueScheduledDispatch(delivery.id, scheduledFor);
    } else {
      this.dispatch.startDispatch(delivery.id).catch((err) => {
        this.logger.error(`Dispatch failed to start for delivery ${delivery.id}: ${err}`);
      });
    }

    return { ...toParticipantView(delivery), trackingUrl: trackLink };
  }

  // Fired by the delivery-schedule queue shortly before scheduledFor. A
  // delivery cancelled in the meantime is simply skipped.
  async releaseScheduledDelivery(deliveryId: string) {
    const released = await this.prisma.delivery.updateMany({
      where: { id: deliveryId, status: DeliveryStatus.SCHEDULED },
      data: { status: DeliveryStatus.REQUESTED },
    });
    if (released.count === 0) {
      return;
    }
    await this.dispatch.startDispatch(deliveryId);
  }

  async updateStops(userId: string, deliveryId: string, stops: StopInput[]) {
    const delivery = await this.findDeliveryForSender(userId, deliveryId);
    const editableStatuses: DeliveryStatus[] = [
      DeliveryStatus.SCHEDULED,
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
      tariffServiceType(delivery.serviceType),
    );
    const subtotal = this.pricing.calculateFare(tariff, route.distanceKm, route.durationMinutes);
    // The promo was redeemed at booking for a fixed amount — keep honouring
    // it, capped at the new subtotal (buildFareBreakdown does the capping).
    const fare = await this.pricing.buildFareBreakdown(
      subtotal,
      delivery.promoDiscount ?? new Prisma.Decimal(0),
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
          subtotalFare: fare.subtotal,
          promoDiscount: fare.promoDiscount,
          taxAmount: fare.tax,
          estimatedFare: fare.total,
        },
      });
    });

    return this.getDelivery(userId, deliveryId);
  }

  // The package-tracking screen: the delivery, the driver card, their live
  // position while the job is active, and the progress timeline.
  async getDelivery(userId: string, deliveryId: string) {
    const delivery = await this.findDeliveryForParticipant(userId, deliveryId);
    const [driver, driverPosition] = await Promise.all([
      delivery.driverId ? this.driverProfiles.getDriverCard(delivery.driverId) : null,
      delivery.driverId && LIVE_DELIVERY_STATUSES.includes(delivery.status)
        ? this.readDriverPosition(delivery.driverId)
        : null,
    ]);
    return {
      ...toParticipantView(delivery),
      stops: delivery.stops,
      driver,
      driverPosition,
      timeline: this.buildTimeline(delivery),
    };
  }

  async listDeliveries(userId: string, role: 'SENDER' | 'DRIVER', take = 50, skip = 0) {
    const where: Prisma.DeliveryWhereInput =
      role === 'SENDER' ? { senderId: userId } : { driverId: userId };
    const deliveries = await this.prisma.delivery.findMany({
      where,
      include: { stops: { orderBy: { sequence: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
    return deliveries.map((d) => ({ ...toParticipantView(d), stops: d.stops }));
  }

  // "View proof of delivery" — sender or driver only. The signed URL is
  // short-lived; the app should fetch it when the screen opens.
  async getProofOfDelivery(userId: string, deliveryId: string) {
    const delivery = await this.findDeliveryForParticipant(userId, deliveryId);
    if (!delivery.podType) {
      throw new NotFoundException('No proof of delivery has been submitted yet');
    }
    return {
      type: delivery.podType,
      submittedAt: delivery.podSubmittedAt,
      receiverName: delivery.receiverName,
      receiverOtpVerifiedAt: delivery.receiverOtpVerifiedAt,
      fileUrl: delivery.podFileKey ? await this.r2.getSignedReadUrl(delivery.podFileKey) : null,
    };
  }

  async cancelDelivery(userId: string, deliveryId: string, reason?: string) {
    const delivery = await this.findDeliveryForParticipant(userId, deliveryId);
    const cancellableStatuses: DeliveryStatus[] = [
      DeliveryStatus.SCHEDULED,
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
        tariffServiceType(delivery.serviceType),
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

    if (delivery.status === DeliveryStatus.SCHEDULED) {
      // The job would skip a cancelled delivery anyway; removing it just
      // keeps the queue tidy.
      await this.scheduleQueue.remove(deliveryId).catch(() => undefined);
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

    const cancelled = await this.prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        status: DeliveryStatus.CANCELLED,
        cancelledById: userId,
        cancellationReason: reason,
        cancellationFee,
        cancelledAt: new Date(),
      },
    });
    return toParticipantView(cancelled);
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

    const driverPosition =
      delivery.driverId && LIVE_DELIVERY_STATUSES.includes(delivery.status)
        ? await this.readDriverPosition(delivery.driverId)
        : null;

    return {
      status: delivery.status,
      pickupAddress: delivery.pickupAddress,
      stops: delivery.stops.map((s) => ({ address: s.address, status: s.status })),
      driver: delivery.driver
        ? { firstName: delivery.driver.firstName, vehicleType: delivery.vehicleType }
        : null,
      driverPosition,
      scheduledFor: delivery.scheduledFor,
      timeline: this.buildTimeline(delivery),
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

  // Progress steps for the tracking screen, in order. `at` is null for a
  // step not reached yet; the app picks the labels ("Driver arriving at
  // pickup", "On the way", …) and highlights the first null step as current.
  private buildTimeline(delivery: Delivery) {
    return [
      { step: 'REQUESTED', at: delivery.requestedAt },
      { step: 'ACCEPTED', at: delivery.acceptedAt },
      { step: 'ARRIVED_AT_PICKUP', at: delivery.arrivedAtPickupAt },
      { step: 'PICKED_UP', at: delivery.pickedUpAt },
      { step: 'ARRIVED_AT_DROPOFF', at: delivery.arrivedAtDropoffAt },
      { step: 'DELIVERED', at: delivery.podSubmittedAt },
      { step: 'COMPLETED', at: delivery.completedAt },
    ];
  }

  private async readDriverPosition(driverId: string) {
    const [pos] = await this.redis.client.geopos(GEO_KEY, driverId);
    return pos ? { lng: Number(pos[0]), lat: Number(pos[1]) } : null;
  }

  // "Business Invoice" chosen in the app — bill the sender's company.
  private async resolveSenderBusiness(senderId: string): Promise<string> {
    const sender = await this.prisma.user.findUniqueOrThrow({
      where: { id: senderId },
      include: { business: true },
    });
    if (!sender.business) {
      throw new BadRequestException('Business invoice is only available to business accounts');
    }
    if (sender.business.status !== BusinessStatus.ACTIVE) {
      throw new ForbiddenException('This business account is not active');
    }
    return sender.business.id;
  }

  // Same rule as BusinessService.assertWithinCreditLimit — duplicated here
  // because LogisticsModule can't import BusinessModule (it imports us).
  private async assertWithinCreditLimit(businessId: string, amount: Prisma.Decimal) {
    const [business, payable] = await Promise.all([
      this.prisma.business.findUniqueOrThrow({ where: { id: businessId } }),
      this.wallet.getOrCreateUserAccount(businessId, AccountType.BUSINESS_CREDIT_PAYABLE),
    ]);
    if (payable.balance.plus(amount).greaterThan(business.creditLimit)) {
      throw new ForbiddenException('This would exceed the business credit limit');
    }
  }

  private assertSchedulable(scheduledFor: Date) {
    const lead = scheduledFor.getTime() - Date.now();
    if (Number.isNaN(lead) || lead < MIN_SCHEDULE_LEAD_MS) {
      throw new BadRequestException('Scheduled pickup must be at least 30 minutes from now');
    }
    if (lead > MAX_SCHEDULE_AHEAD_MS) {
      throw new BadRequestException('Scheduled pickup can be at most 30 days ahead');
    }
  }

  private async enqueueScheduledDispatch(deliveryId: string, scheduledFor: Date) {
    const leadMinutes = await this.platformConfig.get<number>(
      DISPATCH_LEAD_CONFIG_KEY,
      DEFAULT_DISPATCH_LEAD_MINUTES,
    );
    const delay = Math.max(0, scheduledFor.getTime() - leadMinutes * 60_000 - Date.now());
    await this.scheduleQueue.add(
      'release',
      { deliveryId },
      // jobId = deliveryId: re-enqueueing is a no-op, and cancel can remove it.
      { jobId: deliveryId, delay, removeOnComplete: true, removeOnFail: 100 },
    );
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
