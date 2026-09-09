import {
  Body,
  Controller,
  Delete,
  FileTypeValidator,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { SessionsService } from './sessions.service';
import { UsersService } from './users.service';

const AVATAR_VALIDATORS = new ParseFilePipe({
  validators: [
    new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
    new FileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ }),
  ],
});

// Path aliases the admin dashboard's Profile Settings page calls. They
// delegate straight to the same services behind /users/me/*.
@ApiTags('accounts')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.SUPPORT_AGENT)
@Controller('admin/profile')
export class AdminProfileController {
  constructor(
    private readonly usersService: UsersService,
    private readonly sessions: SessionsService,
    private readonly authService: AuthService,
  ) {}

  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  @Post('avatar')
  setAvatar(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile(AVATAR_VALIDATORS) file: Express.Multer.File,
  ) {
    return this.usersService.setAvatar(user.userId, file);
  }

  @HttpCode(HttpStatus.OK)
  @Post('change-password')
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.userId, dto, user.sid);
  }

  @Get('sessions')
  listSessions(@CurrentUser() user: AuthenticatedUser) {
    return this.sessions.list(user.userId, user.sid);
  }

  @HttpCode(HttpStatus.OK)
  @Delete('sessions/all-other')
  revokeOtherSessions(@CurrentUser() user: AuthenticatedUser) {
    return this.sessions.revokeAllOthers(user.userId, user.sid);
  }

  @HttpCode(HttpStatus.OK)
  @Delete('sessions/:id')
  revokeSession(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.sessions.revoke(user.userId, id);
  }
}
