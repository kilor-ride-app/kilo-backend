import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { DispatchService } from './dispatch.service';
import { DriverLocationDto } from './dto/driver-location.dto';
import { DriverStatusDto } from './dto/driver-status.dto';

// Path shape matches plan.md's `/drivers/{id}/...` and
// `/dispatch/{ride_id}/offers/{driver_id}/...`, but every {driver_id} is
// checked against the authenticated caller — a driver can only ever act as
// themselves, never on another driver's behalf just because they know an ID.
@ApiTags('rides')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller()
export class DispatchController {
  constructor(private readonly dispatch: DispatchService) {}

  @HttpCode(HttpStatus.OK)
  @Post('drivers/:id/status')
  async setStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DriverStatusDto,
  ) {
    this.assertDriverSelf(user, id);
    return this.dispatch.setDriverStatus(
      user.userId,
      dto.availability,
      dto.vehicleType,
      dto.serviceMode,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('drivers/:id/location')
  async pushLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DriverLocationDto,
  ) {
    this.assertDriverSelf(user, id);
    await this.dispatch.pushLocation(user.userId, dto.lat, dto.lng);
    return { received: true };
  }

  // "Internal/system: start driver matching" per plan.md — POST /rides
  // already kicks this off automatically; this exists for a manual/system
  // retry (e.g. after a NO_DRIVERS_FOUND resolution).
  @HttpCode(HttpStatus.OK)
  @Post('dispatch/:rideId/start')
  async startDispatch(@Param('rideId') rideId: string) {
    await this.dispatch.startDispatch(rideId);
    return { started: true };
  }

  @HttpCode(HttpStatus.OK)
  @Post('dispatch/:rideId/offers/:driverId/accept')
  async acceptOffer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('rideId') rideId: string,
    @Param('driverId') driverId: string,
  ) {
    this.assertDriverSelf(user, driverId);
    return this.dispatch.acceptOffer(user.userId, rideId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('dispatch/:rideId/offers/:driverId/decline')
  async declineOffer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('rideId') rideId: string,
    @Param('driverId') driverId: string,
  ) {
    this.assertDriverSelf(user, driverId);
    return this.dispatch.declineOffer(user.userId, rideId);
  }

  private assertDriverSelf(user: AuthenticatedUser, pathDriverId: string) {
    if (user.role !== UserRole.DRIVER || user.userId !== pathDriverId) {
      throw new ForbiddenException('You can only act as yourself');
    }
  }
}
