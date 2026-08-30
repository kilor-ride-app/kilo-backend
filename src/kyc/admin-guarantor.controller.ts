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
import { ListGuarantorsQueryDto } from './dto/list-guarantors-query.dto';
import { RejectGuarantorDto } from './dto/reject-guarantor.dto';
import { GuarantorService } from './guarantor.service';

// Reuses the existing kyc.approve/kyc.reject permissions — guarantor
// verification is a form of driver KYC, not a separate admin surface.
@ApiTags('kyc')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('admin/guarantors')
export class AdminGuarantorController {
  constructor(private readonly guarantor: GuarantorService) {}

  @RequirePermissions('kyc.approve')
  @Get()
  list(@Query() query: ListGuarantorsQueryDto) {
    return this.guarantor.listPending(query.status, query.take, query.skip);
  }

  @RequirePermissions('kyc.approve')
  @HttpCode(HttpStatus.OK)
  @Post(':id/approve')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.guarantor.approve(id, user.userId);
  }

  @RequirePermissions('kyc.reject')
  @HttpCode(HttpStatus.OK)
  @Post(':id/reject')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectGuarantorDto,
  ) {
    return this.guarantor.reject(id, user.userId, dto.reason);
  }

  @RequirePermissions('kyc.approve')
  @Get(':id/id-document/url')
  getIdDocumentUrl(@Param('id') id: string) {
    return this.guarantor.getSignedDocumentUrl(id, 'idDocument');
  }

  @RequirePermissions('kyc.approve')
  @Get(':id/proof-of-address/url')
  getProofOfAddressUrl(@Param('id') id: string) {
    return this.guarantor.getSignedDocumentUrl(id, 'proofOfAddress');
  }
}
