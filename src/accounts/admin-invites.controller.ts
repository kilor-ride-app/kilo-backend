import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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
import { CreateInviteDto } from './dto/create-invite.dto';
import { InvitesService } from './invites.service';

// Coarse gate (must be admin-tier at all) AND fine permission (must
// specifically hold a role granting staff.invite — SUPER_ADMIN bypasses
// this automatically via PermissionsGuard). See kilo-backend-plan.md
// discussion on layering UserRole (coarse) with Role/Permission (fine).
@ApiTags('accounts')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('admin/staff/invites')
export class AdminInvitesController {
  constructor(private readonly invitesService: InvitesService) {}

  @RequirePermissions('staff.invite')
  @Post()
  createInvite(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateInviteDto) {
    return this.invitesService.createInvite(user.userId, dto);
  }

  @RequirePermissions('staff.manage')
  @Get()
  listInvites() {
    return this.invitesService.listInvites();
  }

  @RequirePermissions('staff.manage')
  @Post(':id/revoke')
  revokeInvite(@Param('id') id: string) {
    return this.invitesService.revokeInvite(id);
  }

  @RequirePermissions('staff.invite')
  @HttpCode(HttpStatus.OK)
  @Post(':id/resend')
  resendInvite(@Param('id') id: string) {
    return this.invitesService.resendInvite(id);
  }
}
