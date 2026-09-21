import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { sendExport } from '../common/export/export.util';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { AdminLogisticsService } from './admin-logistics.service';
import { AssignDriverDto } from './dto/assign-driver.dto';
import { DisputeDeliveryDto } from './dto/dispute-delivery.dto';
import { ExportDeliveriesQueryDto, ListDeliveriesQueryDto } from './dto/list-deliveries-query.dto';

@ApiTags('logistics')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@RequirePermissions('logistics.manage')
@Controller('admin/deliveries')
export class AdminLogisticsController {
  constructor(private readonly adminLogistics: AdminLogisticsService) {}

  @Get()
  listDeliveries(@Query() query: ListDeliveriesQueryDto) {
    return this.adminLogistics.listDeliveries(query);
  }

  @Get('export')
  async exportDeliveries(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ExportDeliveriesQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const doc = await this.adminLogistics.exportDeliveries(query, user.userId);
    return sendExport(res, doc, query.format, 'deliveries');
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
