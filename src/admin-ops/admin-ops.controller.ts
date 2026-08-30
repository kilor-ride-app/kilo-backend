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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { PaginationDto } from '../wallet/dto/pagination.dto';
import { AdminOpsService } from './admin-ops.service';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { SuspendUserDto } from './dto/suspend-user.dto';

@ApiTags('admin-ops')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('admin')
export class AdminOpsController {
  constructor(private readonly adminOps: AdminOpsService) {}

  @RequirePermissions('admin.dashboard.view')
  @Get('dashboard/summary')
  getDashboardSummary() {
    return this.adminOps.getDashboardSummary();
  }

  @RequirePermissions('admin.dashboard.view')
  @Get('dashboard/live-map')
  getLiveMap() {
    return this.adminOps.getLiveMap();
  }

  @RequirePermissions('admin.users.manage')
  @Get('riders')
  listRiders(@Query() query: ListUsersQueryDto) {
    return this.adminOps.listRiders(query.search, query.take ?? 50, query.skip ?? 0);
  }

  @RequirePermissions('admin.users.manage')
  @Get('riders/:id')
  getRiderDetail(@Param('id') id: string) {
    return this.adminOps.getRiderDetail(id);
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
  listDrivers(@Query() query: ListUsersQueryDto) {
    return this.adminOps.listDrivers(query.search, query.take ?? 50, query.skip ?? 0);
  }

  @RequirePermissions('admin.users.manage')
  @Get('drivers/:id')
  getDriverDetail(@Param('id') id: string) {
    return this.adminOps.getDriverDetail(id);
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
  @Get('audit-logs')
  getAuditLogs(@Query() query: PaginationDto) {
    return this.adminOps.getAuditLogs(query.take ?? 50, query.skip ?? 0);
  }
}
