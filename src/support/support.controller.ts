import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { PaginationDto } from '../wallet/dto/pagination.dto';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { ReplyTicketDto } from './dto/reply-ticket.dto';
import { SupportService } from './support.service';

@ApiTags('support')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('support/tickets')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  createTicket(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTicketDto) {
    return this.support.createTicket(user.userId, dto);
  }

  @Get()
  listMyTickets(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationDto) {
    return this.support.listMyTickets(user.userId, query.take, query.skip);
  }

  @Get(':id')
  getTicket(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.support.getTicket(user.userId, user.role, id);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/reply')
  reply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReplyTicketDto,
  ) {
    return this.support.reply(user.userId, user.role, id, dto.body);
  }
}
