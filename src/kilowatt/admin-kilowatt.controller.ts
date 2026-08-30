import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PaginationDto } from '../wallet/dto/pagination.dto';
import { BatterySwapService } from './battery-swap.service';
import { ChargingStationsService } from './charging-stations.service';
import { CreateBatterySwapStationDto } from './dto/create-battery-swap-station.dto';
import { CreateChargingStationDto } from './dto/create-charging-station.dto';
import { UpdateBatterySwapStationDto } from './dto/update-battery-swap-station.dto';
import { UpdateChargingStationDto } from './dto/update-charging-station.dto';
import { ListSolarLeadsQueryDto } from './dto/list-solar-leads-query.dto';
import { UpdateSolarLeadDto } from './dto/update-solar-lead.dto';
import { SolarAssessmentsService } from './solar-assessments.service';

@ApiTags('kilowatt')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@RequirePermissions('kilowatt.manage')
@Controller('admin')
export class AdminKilowattController {
  constructor(
    private readonly chargingStations: ChargingStationsService,
    private readonly batterySwap: BatterySwapService,
    private readonly solarAssessments: SolarAssessmentsService,
  ) {}

  @Get('charging-stations')
  listStations() {
    return this.chargingStations.listAll();
  }

  @Post('charging-stations')
  createStation(@Body() dto: CreateChargingStationDto) {
    return this.chargingStations.createStation(dto);
  }

  @Patch('charging-stations/:id')
  updateStation(@Param('id') id: string, @Body() dto: UpdateChargingStationDto) {
    return this.chargingStations.updateStation(id, dto);
  }

  @Get('battery-swap/stations')
  listSwapStations() {
    return this.batterySwap.listAllStations();
  }

  @Post('battery-swap/stations')
  createSwapStation(@Body() dto: CreateBatterySwapStationDto) {
    return this.batterySwap.createStation(dto);
  }

  @Patch('battery-swap/stations/:id')
  updateSwapStation(@Param('id') id: string, @Body() dto: UpdateBatterySwapStationDto) {
    return this.batterySwap.updateStation(id, dto);
  }

  @Get('battery-swap/reservations')
  listReservations(@Query() query: PaginationDto) {
    return this.batterySwap.listAllReservations(query.take, query.skip);
  }

  @Get('solar-leads')
  listSolarLeads(@Query() query: ListSolarLeadsQueryDto) {
    return this.solarAssessments.listLeads(query.status, query.take, query.skip);
  }

  @HttpCode(HttpStatus.OK)
  @Patch('solar-leads/:id')
  updateSolarLead(@Param('id') id: string, @Body() dto: UpdateSolarLeadDto) {
    return this.solarAssessments.updateLead(id, dto);
  }
}
