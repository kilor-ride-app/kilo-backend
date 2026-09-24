import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { PaginationDto } from '../wallet/dto/pagination.dto';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationDto) {
    return this.notifications.listNotifications(user.userId, query.take, query.skip);
  }

  // Bell badge on the home screen.
  @Get('notifications/unread-count')
  unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.unreadCount(user.userId);
  }

  @HttpCode(HttpStatus.OK)
  @Delete('notifications/:id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.notifications.deleteNotification(user.userId, id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('notifications/:id/read')
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.notifications.markRead(user.userId, id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('notifications/read-all')
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllRead(user.userId);
  }

  @Get('notifications/preferences')
  getPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.getPreferences(user.userId);
  }

  @Patch('notifications/preferences')
  updatePreferences(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdatePreferencesDto) {
    return this.notifications.updatePreferences(user.userId, dto.preferences);
  }

  @HttpCode(HttpStatus.OK)
  @Post('devices/register')
  registerDevice(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterDeviceDto) {
    return this.notifications.registerDevice(user.userId, dto.token, dto.platform);
  }

  @Delete('devices/:token')
  unregisterDevice(@CurrentUser() user: AuthenticatedUser, @Param('token') token: string) {
    return this.notifications.unregisterDevice(user.userId, token);
  }
}
