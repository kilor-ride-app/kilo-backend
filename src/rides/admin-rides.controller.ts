import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PaginationDto } from '../wallet/dto/pagination.dto';
import { CancellationService } from './cancellation.service';

@ApiTags('rides')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@RequirePermissions('rides.view')
@Controller('admin/rides')
export class AdminRidesController {
  constructor(private readonly cancellation: CancellationService) {}

  @Get('cancellations')
  listCancellations(@Query() query: PaginationDto) {
    return this.cancellation.listCancellations(query.take, query.skip);
  }
}
