import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { AnalyticsRangeDto } from '../common/dto/analytics-range.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { sendExport } from '../common/export/export.util';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';
import { AdminFinanceService } from './admin-finance.service';
import {
  ExportTransactionsQueryDto,
  ListTransactionsQueryDto,
} from './dto/list-transactions-query.dto';
import {
  ExportWithdrawalsQueryDto,
  ListWithdrawalsQueryDto,
} from './dto/list-withdrawals-query.dto';

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

  @Get('finance/transactions/export')
  async exportTransactions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ExportTransactionsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const doc = await this.finance.exportTransactions(query, user.userId);
    return sendExport(res, doc, query.format, 'transactions');
  }

  @Get('withdrawals/export')
  async exportWithdrawals(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ExportWithdrawalsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const doc = await this.finance.exportWithdrawals(query, user.userId);
    return sendExport(res, doc, query.format, 'withdrawals');
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
