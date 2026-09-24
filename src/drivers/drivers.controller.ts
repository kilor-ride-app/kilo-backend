import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { DriverProfilesService } from './driver-profiles.service';
import { UpsertDriverVehicleDto } from './dto/driver-vehicle.dto';

@ApiTags('drivers')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DRIVER)
@Controller('drivers/me')
export class DriversController {
  constructor(private readonly profiles: DriverProfilesService) {}

  // null until the driver has registered a vehicle.
  @Get('vehicle')
  getVehicle(@CurrentUser() user: AuthenticatedUser) {
    return this.profiles.getVehicle(user.userId);
  }

  @Put('vehicle')
  upsertVehicle(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertDriverVehicleDto) {
    return this.profiles.upsertVehicle(user.userId, dto);
  }
}
