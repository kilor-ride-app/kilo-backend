import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { PaginationDto } from '../wallet/dto/pagination.dto';
import { BusinessInvoicesService } from './business-invoices.service';
import { BusinessService } from './business.service';
import { CreateBusinessDto } from './dto/create-business.dto';
import { InviteTeamMemberDto } from './dto/invite-team-member.dto';
import { ScheduleDeliveriesDto } from './dto/schedule-deliveries.dto';

// Every {id} is checked against the caller's own businessId — a member of
// one business can never read or act on another business's data just by
// guessing its ID, same pattern used throughout this codebase for
// self-scoped resources (drivers, KYC, deliveries).
@ApiTags('business')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('business')
export class BusinessController {
  constructor(
    private readonly business: BusinessService,
    private readonly invoices: BusinessInvoicesService,
  ) {}

  @Post()
  createBusiness(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBusinessDto) {
    return this.business.createBusiness(user.userId, dto);
  }

  @Get(':id')
  getBusiness(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.business.getBusiness(user.userId, id);
  }

  @Post(':id/team-members')
  inviteTeamMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: InviteTeamMemberDto,
  ) {
    return this.business.inviteTeamMember(user.userId, id, dto);
  }

  @Get(':id/team-members')
  listTeamMembers(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.business.listTeamMembers(user.userId, id);
  }

  @Delete(':id/team-members/:userId')
  removeTeamMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.business.removeTeamMember(user.userId, id, targetUserId);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/deliveries/schedule')
  scheduleDeliveries(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ScheduleDeliveriesDto,
  ) {
    return this.invoices.scheduleDeliveries(user.userId, id, dto.deliveries);
  }

  @Get(':id/invoices')
  listInvoices(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: PaginationDto,
  ) {
    return this.invoices.listInvoices(user.userId, id, query.take, query.skip);
  }

  @Get(':id/invoices/:invoiceId')
  getInvoice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.invoices.getInvoice(user.userId, id, invoiceId);
  }

  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @UseInterceptors(IdempotencyInterceptor)
  @HttpCode(HttpStatus.OK)
  @Post(':id/invoices/:invoiceId/pay')
  payInvoice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.invoices.payInvoice(user.userId, id, invoiceId);
  }

  @Get(':id/credit')
  getCredit(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.business.getCredit(user.userId, id);
  }
}
