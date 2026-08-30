import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateCommissionRuleDto } from './dto/create-commission-rule.dto';
import { CreateTariffDto } from './dto/create-tariff.dto';
import { UpdateCommissionRuleDto } from './dto/update-commission-rule.dto';
import { UpdateTariffDto } from './dto/update-tariff.dto';
import { PricingService } from './pricing.service';

@ApiTags('pricing')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@RequirePermissions('wallet.commission.edit')
@Controller('admin/pricing')
export class AdminPricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get('tariffs')
  listTariffs() {
    return this.pricing.listTariffs();
  }

  @Post('tariffs')
  createTariff(@Body() dto: CreateTariffDto) {
    return this.pricing.createTariff(dto);
  }

  @Patch('tariffs/:id')
  updateTariff(@Param('id') id: string, @Body() dto: UpdateTariffDto) {
    return this.pricing.updateTariff(id, dto);
  }

  @Delete('tariffs/:id')
  deactivateTariff(@Param('id') id: string) {
    return this.pricing.deactivateTariff(id);
  }

  @Get('commissions')
  listCommissionRules() {
    return this.pricing.listCommissionRules();
  }

  @Post('commissions')
  createCommissionRule(@Body() dto: CreateCommissionRuleDto) {
    return this.pricing.createCommissionRule(dto);
  }

  @Patch('commissions/:id')
  updateCommissionRule(@Param('id') id: string, @Body() dto: UpdateCommissionRuleDto) {
    return this.pricing.updateCommissionRule(id, dto);
  }
}
