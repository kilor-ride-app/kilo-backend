import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { AccountType, UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { PaginationDto } from './dto/pagination.dto';
import { TopUpDto } from './dto/top-up.dto';
import { WithdrawDto } from './dto/withdraw.dto';
import { PaymentsService } from './payments.service';
import { WalletService } from './wallet.service';

function primaryAccountType(role: UserRole): AccountType {
  if (role === UserRole.RIDER) return AccountType.RIDER_WALLET;
  if (role === UserRole.DRIVER) return AccountType.DRIVER_WALLET;
  throw new ForbiddenException('This account type has no wallet');
}

@ApiTags('wallet')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly payments: PaymentsService,
  ) {}

  @Get()
  async getWallet(@CurrentUser() user: AuthenticatedUser) {
    return this.wallet.getOrCreateUserAccount(user.userId, primaryAccountType(user.role));
  }

  @Get('transactions')
  async getTransactions(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationDto) {
    const account = await this.wallet.getOrCreateUserAccount(
      user.userId,
      primaryAccountType(user.role),
    );
    return this.wallet.getTransactionsForAccount(account.id, query.take, query.skip);
  }

  @Get('commission/outstanding')
  async getOutstandingCommission(@CurrentUser() user: AuthenticatedUser) {
    if (user.role !== UserRole.DRIVER) {
      throw new ForbiddenException('Only drivers accrue commission');
    }
    const account = await this.wallet.getOrCreateUserAccount(
      user.userId,
      AccountType.DRIVER_COMMISSION_PAYABLE,
    );
    return { outstanding: account.balance };
  }

  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @UseInterceptors(IdempotencyInterceptor)
  @HttpCode(HttpStatus.OK)
  @Post('topup')
  async topUp(@CurrentUser() user: AuthenticatedUser, @Body() dto: TopUpDto) {
    return this.payments.initiateTopUp(user.userId, dto.amount);
  }

  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @UseInterceptors(IdempotencyInterceptor)
  @HttpCode(HttpStatus.OK)
  @Post('withdraw')
  async withdraw(@CurrentUser() user: AuthenticatedUser, @Body() dto: WithdrawDto) {
    if (user.role !== UserRole.DRIVER) {
      throw new ForbiddenException('Only drivers can request withdrawals');
    }
    return this.payments.initiateWithdrawal(
      user.userId,
      dto.amount,
      dto.accountNumber,
      dto.bankCode,
    );
  }
}
