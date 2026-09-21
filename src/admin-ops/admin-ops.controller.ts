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
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AnalyticsRangeDto } from '../common/dto/analytics-range.dto';
import { sendExport } from '../common/export/export.util';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { PaginationDto } from '../wallet/dto/pagination.dto';
import { AdminOpsService } from './admin-ops.service';
import { AnalyticsService } from './analytics.service';
import { ExportAuditQueryDto, ListAuditQueryDto } from './dto/list-audit-query.dto';
import { LiveMapQueryDto } from './dto/live-map-query.dto';
import { ExportDriversQueryDto, ListDriversQueryDto } from './dto/list-drivers-query.dto';
import { ExportUsersQueryDto, ListUsersQueryDto } from './dto/list-users-query.dto';
import { SuspendUserDto } from './dto/suspend-user.dto';

@ApiTags('admin-ops')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('admin')
export class AdminOpsController {
  constructor(
    private readonly adminOps: AdminOpsService,
    private readonly analytics: AnalyticsService,
  ) {}

  @RequirePermissions('admin.dashboard.view')
  @Get('dashboard/summary')
  getDashboardSummary() {
    return this.adminOps.getDashboardSummary();
  }

  @RequirePermissions('admin.dashboard.view')
  @Get('dashboard/analytics')
  getAnalytics(@Query() query: AnalyticsRangeDto) {
    return this.analytics.platformAnalytics(query.range);
  }

  @RequirePermissions('admin.dashboard.view')
  @Get('dashboard/needs-attention')
  getNeedsAttention() {
    return this.adminOps.getNeedsAttention();
  }

  @RequirePermissions('admin.dashboard.view')
  @Get('dashboard/live-map')
  getLiveMap() {
    return this.adminOps.getLiveMap();
  }

  @RequirePermissions('admin.dashboard.view')
  @Get('live-map/fleet')
  getFleetMap(@Query() query: LiveMapQueryDto) {
    return this.adminOps.getFleetMap(query);
  }

  @RequirePermissions('admin.users.manage')
  @Get('riders')
  listRiders(@Query() query: ListUsersQueryDto) {
    return this.adminOps.listRiders(query);
  }

  // Static segment — must stay above `riders/:id`.
  @RequirePermissions('admin.users.manage')
  @Get('riders/export')
  async exportRiders(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ExportUsersQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const doc = await this.adminOps.exportRiders(query, user.userId);
    return sendExport(res, doc, query.format, 'riders');
  }

  @RequirePermissions('admin.users.manage')
  @Get('riders/:id')
  getRiderDetail(@Param('id') id: string) {
    return this.adminOps.getRiderDetail(id);
  }

  @RequirePermissions('admin.users.manage')
  @Get('riders/:id/rides')
  getRiderRides(@Param('id') id: string, @Query() query: PaginationDto) {
    return this.adminOps.getRiderRides(id, query.take ?? 50, query.skip ?? 0);
  }

  @RequirePermissions('admin.users.manage')
  @Get('riders/:id/deliveries')
  getRiderDeliveries(@Param('id') id: string, @Query() query: PaginationDto) {
    return this.adminOps.getRiderDeliveries(id, query.take ?? 50, query.skip ?? 0);
  }

  @RequirePermissions('admin.users.manage')
  @Get('riders/:id/transactions')
  getRiderTransactions(@Param('id') id: string, @Query() query: PaginationDto) {
    return this.adminOps.getUserTransactions(id, query.take ?? 50, query.skip ?? 0);
  }

  @RequirePermissions('admin.users.manage')
  @HttpCode(HttpStatus.OK)
  @Post('riders/:id/suspend')
  suspendRider(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SuspendUserDto,
  ) {
    return this.adminOps.suspendUser(id, user.userId, dto.reason);
  }

  @RequirePermissions('admin.users.manage')
  @HttpCode(HttpStatus.OK)
  @Post('riders/:id/activate')
  activateRider(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.adminOps.activateUser(id, user.userId);
  }

  @RequirePermissions('admin.users.manage')
  @Get('drivers')
  listDrivers(@Query() query: ListDriversQueryDto) {
    return this.adminOps.listDrivers(query);
  }

  // Static segment — must stay above `drivers/:id`.
  @RequirePermissions('admin.users.manage')
  @Get('drivers/export')
  async exportDrivers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ExportDriversQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const doc = await this.adminOps.exportDrivers(query, user.userId);
    return sendExport(res, doc, query.format, 'drivers');
  }

  @RequirePermissions('admin.users.manage')
  @Get('drivers/:id')
  getDriverDetail(@Param('id') id: string) {
    return this.adminOps.getDriverDetail(id);
  }

  @RequirePermissions('admin.users.manage')
  @Get('drivers/:id/rides')
  getDriverRides(@Param('id') id: string, @Query() query: PaginationDto) {
    return this.adminOps.getDriverRides(id, query.take ?? 50, query.skip ?? 0);
  }

  @RequirePermissions('admin.users.manage')
  @Get('drivers/:id/deliveries')
  getDriverDeliveries(@Param('id') id: string, @Query() query: PaginationDto) {
    return this.adminOps.getDriverDeliveries(id, query.take ?? 50, query.skip ?? 0);
  }

  @RequirePermissions('admin.users.manage')
  @Get('drivers/:id/transactions')
  getDriverTransactions(@Param('id') id: string, @Query() query: PaginationDto) {
    return this.adminOps.getUserTransactions(id, query.take ?? 50, query.skip ?? 0);
  }

  @RequirePermissions('admin.users.manage')
  @Get('drivers/:id/withdrawals')
  getDriverWithdrawals(@Param('id') id: string, @Query() query: PaginationDto) {
    return this.adminOps.getDriverWithdrawals(id, query.take ?? 50, query.skip ?? 0);
  }

  @RequirePermissions('admin.users.manage')
  @HttpCode(HttpStatus.OK)
  @Post('drivers/:id/suspend')
  suspendDriver(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SuspendUserDto,
  ) {
    return this.adminOps.suspendUser(id, user.userId, dto.reason);
  }

  @RequirePermissions('admin.users.manage')
  @HttpCode(HttpStatus.OK)
  @Post('drivers/:id/activate')
  activateDriver(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.adminOps.activateUser(id, user.userId);
  }

  @RequirePermissions('admin.config.edit')
  @Get('config')
  getConfig() {
    return this.adminOps.getConfig();
  }

  // Open key/value bag by design (tunables like maxUnsettledCashRides,
  // future ones) — deliberately typed as a plain Record rather than a
  // class-validated DTO so the global ValidationPipe's whitelist doesn't
  // strip unknown keys (see main.ts).
  @RequirePermissions('admin.config.edit')
  @Patch('config')
  updateConfig(@CurrentUser() user: AuthenticatedUser, @Body() updates: Record<string, unknown>) {
    return this.adminOps.updateConfig(updates, user.userId);
  }

  @RequirePermissions('admin.audit.view')
  @Get('audit-logs/export')
  async exportAuditLogs(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ExportAuditQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const doc = await this.adminOps.exportAuditLogs(query, user.userId);
    return sendExport(res, doc, query.format, 'audit-log');
  }

  @RequirePermissions('admin.audit.view')
  @Get('audit-logs')
  getAuditLogs(@Query() query: ListAuditQueryDto) {
    return this.adminOps.getAuditLogs(query);
  }
}
