import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreatePromoDto } from './dto/create-promo.dto';
import { UpdatePromoDto } from './dto/update-promo.dto';
import { PromoService } from './promo.service';

@ApiTags('promo')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@RequirePermissions('promos.manage')
@Controller('admin/promos')
export class AdminPromoController {
  constructor(private readonly promo: PromoService) {}

  @Post()
  create(@Body() dto: CreatePromoDto) {
    return this.promo.createPromo(dto);
  }

  @Get()
  list() {
    return this.promo.listPromos();
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePromoDto) {
    return this.promo.updatePromo(id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.promo.deletePromo(id);
  }

  @Get(':id/redemptions')
  redemptions(@Param('id') id: string) {
    return this.promo.getRedemptionStats(id);
  }
}
