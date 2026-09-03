import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AnalyticsRangeDto } from '../common/dto/analytics-range.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AdminFinanceService } from './admin-finance.service';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import { ListWithdrawalsQueryDto } from './dto/list-withdrawals-query.dto';

@ApiTags('wallet')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@RequirePermissions('finance.transactions.view')
@Controller('admin')
export class AdminWalletController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: AdminFinanceService,
  ) {}

  @Get('finance/stats')
  financeStats() {
    return this.finance.stats();
  }

  @Get('finance/revenue-by-service')
  revenueByService(@Query() query: AnalyticsRangeDto) {
    return this.finance.revenueByService(query.range);
  }

  @Get('finance/topup-trend')
  topupTrend(@Query() query: AnalyticsRangeDto) {
    return this.finance.topupTrend(query.range);
  }

  @Get('finance/transactions')
  listTransactions(@Query() query: ListTransactionsQueryDto) {
    return this.finance.listTransactions(query);
  }

  @Get('withdrawals')
  listWithdrawals(@Query() query: ListWithdrawalsQueryDto) {
    return this.finance.listWithdrawals(query);
  }

  @Get('wallets/:userId')
  getWallets(@Param('userId') userId: string) {
    return this.prisma.account.findMany({ where: { ownerId: userId } });
  }
}
