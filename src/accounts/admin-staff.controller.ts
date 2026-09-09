import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import { ListStaffQueryDto } from './dto/list-staff-query.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { UsersService } from './users.service';

@ApiTags('accounts')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('admin/staff')
export class AdminStaffController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  listStaff(@Query() query: ListStaffQueryDto) {
    return this.usersService.listStaff(query.status);
  }

  @RequirePermissions('staff.manage')
  @Patch(':id')
  updateStaff(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.usersService.updateStaff(id, dto, user.userId);
  }

  @RequirePermissions('staff.manage')
  @HttpCode(HttpStatus.OK)
  @Delete(':id')
  deprovisionStaff(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.usersService.deprovisionStaff(id, user.userId);
  }
}
