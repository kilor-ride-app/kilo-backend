import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { CancellationService } from './cancellation.service';
import { CancelRideDto } from './dto/cancel-ride.dto';
import { CreateRideDto } from './dto/create-ride.dto';
import { FareEstimateDto } from './dto/fare-estimate.dto';
import { PaginationDto } from '../wallet/dto/pagination.dto';
import { RateRideDto } from './dto/rate-ride.dto';
import { RidesService } from './rides.service';
import { TripService } from './trip.service';

@ApiTags('rides')
@Controller('rides')
export class RidesController {
  constructor(
    private readonly rides: RidesService,
    private readonly trip: TripService,
    private readonly cancellation: CancellationService,
  ) {}

  // Public — checking "how much would this cost" shouldn't require login.
  // A token is still read when present, so a signed-in rider's promo code
  // can be priced in.
  @UseGuards(OptionalJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('fare-estimate')
  fareEstimate(@CurrentUser() user: AuthenticatedUser | null, @Body() dto: FareEstimateDto) {
    return this.rides.estimateFare(dto, user?.userId);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Post()
  async createRide(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateRideDto) {
    if (user.role !== UserRole.RIDER) {
      throw new ForbiddenException('Only riders can book rides');
    }
    return this.rides.createRide(user.userId, dto);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Get()
  async listRides(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationDto) {
    const role = user.role === UserRole.DRIVER ? 'DRIVER' : 'RIDER';
    return this.rides.listRides(user.userId, role, query.take, query.skip);
  }

  // Static segment — must stay above `:id`.
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Get('reviews')
  async listMyReviews(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationDto) {
    return this.rides.listMyReviews(user.userId, query.take, query.skip);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async getRide(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.rides.getRide(user.userId, id);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post(':id/rate')
  async rateRide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RateRideDto,
  ) {
    return this.rides.rateRide(user.userId, id, dto.rating, dto.comment);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post(':id/share')
  async share(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.rides.shareRide(user.userId, id);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post(':id/arrived')
  async arrived(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.trip.markArrived(user.userId, id);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post(':id/start')
  async start(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.trip.startTrip(user.userId, id);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post(':id/complete')
  async complete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.trip.completeTrip(user.userId, id);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Get(':id/receipt')
  async receipt(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.trip.getReceipt(user.userId, id);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post(':id/cancel')
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CancelRideDto,
  ) {
    return this.cancellation.cancel(user.userId, id, dto.reason);
  }
}
