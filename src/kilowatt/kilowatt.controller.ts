import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { BatterySwapService } from './battery-swap.service';
import { ChargingStationsService } from './charging-stations.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { CreateSolarAssessmentDto } from './dto/create-solar-assessment.dto';
import { SearchNearbyDto } from './dto/search-nearby.dto';
import { SolarAssessmentsService } from './solar-assessments.service';

@ApiTags('kilowatt')
@Controller()
export class KilowattController {
  constructor(
    private readonly chargingStations: ChargingStationsService,
    private readonly batterySwap: BatterySwapService,
    private readonly solarAssessments: SolarAssessmentsService,
  ) {}

  // Public — finding a nearby charging station shouldn't require login.
  @Get('charging-stations')
  searchChargingStations(@Query() query: SearchNearbyDto) {
    return this.chargingStations.searchNearby({
      lat: query.lat,
      lng: query.lng,
      radiusKm: query.radiusKm ?? 10,
      chargerType: query.chargerType,
      minSpeedKw: query.minSpeedKw,
    });
  }

  @Get('charging-stations/:id')
  getChargingStation(@Param('id') id: string) {
    return this.chargingStations.getStation(id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('battery-swap/stations')
  searchSwapStations(@Body() dto: SearchNearbyDto) {
    return this.batterySwap.searchNearby({
      lat: dto.lat,
      lng: dto.lng,
      radiusKm: dto.radiusKm ?? 10,
    });
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Post('battery-swap/reservations')
  reserveSwap(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReservationDto) {
    return this.batterySwap.reserve(user.userId, dto.stationId);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Get('battery-swap/reservations/:id')
  getReservation(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.batterySwap.getReservation(user.userId, id);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Post('solar-assessments')
  submitSolarAssessment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSolarAssessmentDto,
  ) {
    return this.solarAssessments.submit(user.userId, dto);
  }
}
