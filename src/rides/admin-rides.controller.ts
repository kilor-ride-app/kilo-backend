import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { sendExport } from '../common/export/export.util';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { PaginationDto } from '../wallet/dto/pagination.dto';
import { AdminRidesService } from './admin-rides.service';
import { CancellationService } from './cancellation.service';
import { ExportRidesQueryDto, ListRidesQueryDto } from './dto/list-rides-query.dto';

@ApiTags('rides')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@RequirePermissions('rides.view')
@Controller('admin/rides')
export class AdminRidesController {
  constructor(
    private readonly cancellation: CancellationService,
    private readonly adminRides: AdminRidesService,
  ) {}

  @Get()
  list(@Query() query: ListRidesQueryDto) {
    return this.adminRides.list(query);
  }

  // Static segments before the `:id` param route.
  @Get('export')
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ExportRidesQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const doc = await this.adminRides.exportRides(query, user.userId);
    return sendExport(res, doc, query.format, 'rides');
  }

  @Get('stats')
  stats() {
    return this.adminRides.stats();
  }

  @Get('cancellations')
  listCancellations(@Query() query: PaginationDto) {
    return this.cancellation.listCancellations(query.take, query.skip);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.adminRides.detail(id);
  }
}
