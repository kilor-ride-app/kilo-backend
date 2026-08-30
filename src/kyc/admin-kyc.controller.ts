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
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { PaginationDto } from '../wallet/dto/pagination.dto';
import { RejectKycDto } from './dto/reject-kyc.dto';
import { KycService } from './kyc.service';

@ApiTags('kyc')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('admin/kyc')
export class AdminKycController {
  constructor(private readonly kyc: KycService) {}

  @RequirePermissions('kyc.approve')
  @Get('pending')
  listPending(@Query() query: PaginationDto) {
    return this.kyc.listPending(query.take, query.skip);
  }

  @RequirePermissions('kyc.approve')
  @HttpCode(HttpStatus.OK)
  @Post(':driverId/approve')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('driverId') driverId: string) {
    return this.kyc.approve(driverId, user.userId);
  }

  @RequirePermissions('kyc.reject')
  @HttpCode(HttpStatus.OK)
  @Post(':driverId/reject')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('driverId') driverId: string,
    @Body() dto: RejectKycDto,
  ) {
    return this.kyc.reject(driverId, user.userId, dto.reason);
  }

  // Not in the plan's endpoint table, but necessary to actually review an
  // uploaded document — R2 objects are never public (plan.md Section 7),
  // so reviewing one means minting a short-lived signed URL on demand.
  @RequirePermissions('kyc.approve')
  @Get('documents/:documentId/url')
  getDocumentUrl(@Param('documentId') documentId: string) {
    return this.kyc.getSignedDocumentUrl(documentId);
  }
}
