import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import { WalletHistoryService } from './wallet-history.service';
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
    private readonly history: WalletHistoryService,
  ) {}

  @Get()
  async getWallet(@CurrentUser() user: AuthenticatedUser) {
    return this.wallet.getOrCreateUserAccount(user.userId, primaryAccountType(user.role));
  }

  // Newest first, each with a display title ("Ride to Lekki"), the
  // payment method, and the amount signed from the user's side.
  @Get('transactions')
  async getTransactions(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationDto) {
    const account = await this.wallet.getOrCreateUserAccount(
      user.userId,
      primaryAccountType(user.role),
    );
    return this.history.listForAccount(account.id, query.take, query.skip);
  }

  @Get('transactions/:id')
  async getTransaction(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const account = await this.wallet.getOrCreateUserAccount(
      user.userId,
      primaryAccountType(user.role),
    );
    return this.history.getForAccount(account.id, id);
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
    return this.payments.initiateTopUp(user.userId, dto);
  }

  // Poll after starting a top-up ("Processing payment") until status is
  // COMPLETED or FAILED. The reference is the one POST /wallet/topup returned.
  @Get('topup/:reference')
  topUpStatus(@CurrentUser() user: AuthenticatedUser, @Param('reference') reference: string) {
    return this.payments.getTopUpStatus(user.userId, reference);
  }

  @Get('cards')
  listCards(@CurrentUser() user: AuthenticatedUser) {
    return this.payments.listCards(user.userId);
  }

  // "Add a card": returns a Paystack checkout for a small verification
  // charge (credited back to the wallet). The card is saved once that
  // payment succeeds — poll GET /wallet/topup/{reference}, then GET /wallet/cards.
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @UseInterceptors(IdempotencyInterceptor)
  @HttpCode(HttpStatus.OK)
  @Post('cards')
  addCard(@CurrentUser() user: AuthenticatedUser) {
    return this.payments.initiateCardSetup(user.userId);
  }

  @Patch('cards/:id/default')
  setDefaultCard(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.payments.setDefaultCard(user.userId, id);
  }

  @HttpCode(HttpStatus.OK)
  @Delete('cards/:id')
  removeCard(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.payments.removeCard(user.userId, id);
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
