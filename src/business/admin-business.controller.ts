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
import { BusinessService } from './business.service';
import { ListBusinessesQueryDto } from './dto/list-businesses-query.dto';
import { SetCreditLimitDto } from './dto/set-credit-limit.dto';

@ApiTags('business')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@RequirePermissions('business.manage')
@Controller('admin/business')
export class AdminBusinessController {
  constructor(private readonly business: BusinessService) {}

  @Get()
  listAll(@Query() query: ListBusinessesQueryDto) {
    return this.business.listAllBusinesses(query);
  }

  @Get('stats')
  stats() {
    return this.business.businessStats();
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.business.getBusinessDetail(id);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/credit-limit')
  setCreditLimit(@Param('id') id: string, @Body() dto: SetCreditLimitDto) {
    return this.business.setCreditLimit(id, dto.creditLimit);
  }
}
