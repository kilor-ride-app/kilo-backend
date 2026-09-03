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
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { BroadcastDto } from './dto/broadcast.dto';
import { ListNotificationHistoryQueryDto } from './dto/list-notification-history-query.dto';
import { ScheduleNotificationDto } from './dto/schedule-notification.dto';
import { TargetedDto } from './dto/targeted.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@RequirePermissions('notifications.send')
@Controller('admin/notifications')
export class AdminNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @HttpCode(HttpStatus.OK)
  @Post('broadcast')
  broadcast(@CurrentUser() user: AuthenticatedUser, @Body() dto: BroadcastDto) {
    return this.notifications.broadcast(user.userId, dto.title, dto.body, dto.category);
  }

  @HttpCode(HttpStatus.OK)
  @Post('targeted')
  targeted(@CurrentUser() user: AuthenticatedUser, @Body() dto: TargetedDto) {
    return this.notifications.targeted(user.userId, dto.title, dto.body, dto.category, dto.segment);
  }

  @HttpCode(HttpStatus.OK)
  @Post('schedule')
  schedule(@CurrentUser() user: AuthenticatedUser, @Body() dto: ScheduleNotificationDto) {
    return this.notifications.schedule(
      user.userId,
      dto.title,
      dto.body,
      dto.category,
      dto.segment,
      new Date(dto.scheduledFor),
    );
  }

  @Get('history')
  history(@Query() query: ListNotificationHistoryQueryDto) {
    return this.notifications.history(query);
  }
}
