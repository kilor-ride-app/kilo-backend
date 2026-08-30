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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { PaginationDto } from '../wallet/dto/pagination.dto';
import { CancelDeliveryDto } from './dto/cancel-delivery.dto';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { ProofOfDeliveryDto } from './dto/proof-of-delivery.dto';
import { QuoteDeliveryDto } from './dto/quote-delivery.dto';
import { UpdateStopsDto } from './dto/update-stops.dto';
import { LogisticsDispatchService } from './logistics-dispatch.service';
import { LogisticsTripService } from './logistics-trip.service';
import { LogisticsService } from './logistics.service';

@ApiTags('logistics')
@Controller()
export class LogisticsController {
  constructor(
    private readonly logistics: LogisticsService,
    private readonly dispatch: LogisticsDispatchService,
    private readonly trip: LogisticsTripService,
  ) {}

  // Public — same rationale as rides/fare-estimate: pricing a job shouldn't require login.
  @HttpCode(HttpStatus.OK)
  @Post('deliveries/quote')
  quote(@Body() dto: QuoteDeliveryDto) {
    return this.logistics.quote(dto);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Post('deliveries')
  createDelivery(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDeliveryDto) {
    return this.logistics.createDelivery(user.userId, dto);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('deliveries/:id/stops')
  updateStops(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateStopsDto,
  ) {
    return this.logistics.updateStops(user.userId, id, dto.stops);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Get('deliveries')
  listDeliveries(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationDto) {
    const role = user.role === UserRole.DRIVER ? 'DRIVER' : 'SENDER';
    return this.logistics.listDeliveries(user.userId, role, query.take, query.skip);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Get('deliveries/:id')
  getDelivery(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.logistics.getDelivery(user.userId, id);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('deliveries/:id/accept')
  acceptDelivery(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    this.assertDriver(user);
    return this.dispatch.acceptOffer(user.userId, id);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('deliveries/:id/decline')
  declineDelivery(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    this.assertDriver(user);
    return this.dispatch.declineOffer(user.userId, id);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('deliveries/:id/pickup-confirm')
  confirmPickup(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    this.assertDriver(user);
    return this.trip.confirmPickup(user.userId, id);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  @HttpCode(HttpStatus.OK)
  @Post('deliveries/:id/proof-of-delivery')
  submitProofOfDelivery(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ProofOfDeliveryDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    this.assertDriver(user);
    return this.trip.submitProofOfDelivery(user.userId, id, dto.type, {
      otpCode: dto.otpCode,
      file,
    });
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('deliveries/:id/complete')
  completeDelivery(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    this.assertDriver(user);
    return this.trip.completeDelivery(user.userId, id);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('deliveries/:id/cancel')
  cancelDelivery(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CancelDeliveryDto,
  ) {
    return this.logistics.cancelDelivery(user.userId, id, dto.reason);
  }

  private assertDriver(user: AuthenticatedUser) {
    if (user.role !== UserRole.DRIVER) {
      throw new ForbiddenException('Only drivers can perform this action');
    }
  }
}
