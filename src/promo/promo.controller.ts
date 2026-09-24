import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { PaginationDto } from '../wallet/dto/pagination.dto';
import { ValidatePromoDto } from './dto/validate-promo.dto';
import { PromoService } from './promo.service';

@ApiTags('promo')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller()
export class PromoController {
  constructor(private readonly promo: PromoService) {}

  @HttpCode(HttpStatus.OK)
  @Post('promos/validate')
  async validate(@CurrentUser() user: AuthenticatedUser, @Body() dto: ValidatePromoDto) {
    const result = await this.promo.validate(
      dto.code,
      dto.service,
      new Prisma.Decimal(dto.fareAmount),
      user.userId,
    );
    return {
      discountAmount: result.discountAmount,
      finalAmount: result.finalAmount,
    };
  }

  @Get('promos/featured')
  featured() {
    return this.promo.listFeatured();
  }

  @Get('users/me/promos/redemptions')
  myRedemptions(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationDto) {
    return this.promo.myRedemptions(user.userId, query.take, query.skip);
  }
}
