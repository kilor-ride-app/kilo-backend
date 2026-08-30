import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { PaginationDto } from './dto/pagination.dto';

@ApiTags('wallet')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@RequirePermissions('finance.transactions.view')
@Controller('admin')
export class AdminWalletController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('wallets/:userId')
  getWallets(@Param('userId') userId: string) {
    return this.prisma.account.findMany({ where: { ownerId: userId } });
  }

  @Get('finance/transactions')
  listTransactions(@Query() query: PaginationDto) {
    return this.prisma.transaction.findMany({
      include: { entries: true },
      orderBy: { createdAt: 'desc' },
      take: query.take,
      skip: query.skip,
    });
  }
}
