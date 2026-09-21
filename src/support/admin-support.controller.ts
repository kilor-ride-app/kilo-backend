import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { sendExport } from '../common/export/export.util';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { AssignTicketDto } from './dto/assign-ticket.dto';
import { EscalateTicketDto } from './dto/escalate-ticket.dto';
import { ExportTicketsQueryDto, ListTicketsQueryDto } from './dto/list-tickets-query.dto';
import { ResolveTicketDto } from './dto/resolve-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { SupportService } from './support.service';

@ApiTags('support')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.SUPPORT_AGENT)
@RequirePermissions('support.tickets.manage')
@Controller('admin/support/tickets')
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  listAll(@Query() query: ListTicketsQueryDto) {
    return this.support.listAllTickets(
      {
        status: query.status,
        priority: query.priority,
        assignedToId: query.assignedToId,
        from: query.from,
        to: query.to,
      },
      query.take,
      query.skip,
    );
  }

  @Get('export')
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ExportTicketsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const doc = await this.support.exportTickets(query, user.userId);
    return sendExport(res, doc, query.format, 'support-tickets');
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateTicketDto,
  ) {
    return this.support.adminUpdate(id, user.userId, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/assign')
  assign(@Param('id') id: string, @Body() dto: AssignTicketDto) {
    return this.support.assign(id, dto.assignedToId);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/escalate')
  escalate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: EscalateTicketDto,
  ) {
    return this.support.escalate(id, user.userId, dto.reason);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/resolve')
  resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ResolveTicketDto,
  ) {
    return this.support.resolve(id, user.userId, dto.resolutionNote);
  }
}
