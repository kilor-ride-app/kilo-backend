import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/jwt-payload.interface';
import { FacialVerificationDto } from './dto/facial-verification.dto';
import { GovernmentIdDto } from './dto/government-id.dto';
import { InviteGuarantorDto } from './dto/invite-guarantor.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { GuarantorService } from './guarantor.service';
import { KycService } from './kyc.service';

// Every {id} is checked against the authenticated caller — a driver can
// only ever submit/view their own KYC, never another driver's by ID
// (same pattern as the dispatch/driver-status endpoints in RidesModule).
@ApiTags('kyc')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('drivers')
export class KycController {
  constructor(
    private readonly kyc: KycService,
    private readonly guarantor: GuarantorService,
  ) {}

  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  @Post(':id/kyc/documents')
  uploadDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    this.assertSelf(user, id);
    return this.kyc.uploadDocument(user.userId, dto.type, file);
  }

  @Post(':id/kyc/facial-verification')
  submitFacialVerification(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: FacialVerificationDto,
  ) {
    this.assertSelf(user, id);
    return this.kyc.submitFacialVerification(user.userId, dto.selfieImageBase64);
  }

  @Post(':id/kyc/government-id')
  submitGovernmentId(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: GovernmentIdDto,
  ) {
    this.assertSelf(user, id);
    return this.kyc.submitGovernmentId(user.userId, dto.idType, dto.idNumber);
  }

  @Get(':id/kyc/status')
  getStatus(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    this.assertSelf(user, id);
    return this.kyc.getStatus(user.userId);
  }

  @Post(':id/guarantor/invite')
  inviteGuarantor(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: InviteGuarantorDto,
  ) {
    this.assertSelf(user, id);
    return this.guarantor.invite(user.userId, dto);
  }

  @Get(':id/guarantor')
  getGuarantorStatus(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    this.assertSelf(user, id);
    return this.guarantor.getStatus(user.userId);
  }

  private assertSelf(user: AuthenticatedUser, pathId: string) {
    if (user.userId !== pathId) {
      throw new ForbiddenException('You can only manage your own KYC submissions');
    }
  }
}
