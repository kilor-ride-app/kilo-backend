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
import { UserRole } from '@prisma/client';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { PaginationDto } from '../wallet/dto/pagination.dto';
import { AdminLogisticsService } from './admin-logistics.service';
import { AssignDriverDto } from './dto/assign-driver.dto';
import { DisputeDeliveryDto } from './dto/dispute-delivery.dto';

@ApiTags('logistics')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@RequirePermissions('logistics.manage')
@Controller('admin/deliveries')
export class AdminLogisticsController {
  constructor(private readonly adminLogistics: AdminLogisticsService) {}

  @Get()
  listDeliveries(@Query() query: PaginationDto) {
    return this.adminLogistics.listDeliveries(query.take, query.skip);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/assign')
  assignDriver(@Param('id') id: string, @Body() dto: AssignDriverDto) {
    return this.adminLogistics.assignDriver(id, dto.driverId);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/dispute')
  resolveDispute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DisputeDeliveryDto,
  ) {
    return this.adminLogistics.resolveDispute(id, user.userId, dto.resolution, dto.refund);
  }

  @Get(':id/pod-url')
  getPodUrl(@Param('id') id: string) {
    return this.adminLogistics.getSignedPodUrl(id);
  }
}
