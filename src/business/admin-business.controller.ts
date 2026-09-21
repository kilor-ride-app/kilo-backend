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
import { sendExport } from '../common/export/export.util';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { BusinessService } from './business.service';
import { ExportBusinessesQueryDto, ListBusinessesQueryDto } from './dto/list-businesses-query.dto';
import { SetBusinessStatusDto } from './dto/set-business-status.dto';
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

  @Get('export')
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ExportBusinessesQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const doc = await this.business.exportBusinesses(query, user.userId);
    return sendExport(res, doc, query.format, 'businesses');
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

  @Patch(':id')
  setStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SetBusinessStatusDto,
  ) {
    return this.business.setStatus(id, dto.status, user.userId);
  }
}
