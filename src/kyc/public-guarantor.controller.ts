import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { SubmitGuarantorDto } from './dto/submit-guarantor.dto';
import { GuarantorService } from './guarantor.service';

// Public — no auth at all. The token itself is the credential, same
// rationale as LogisticsModule's public delivery-tracking routes.
@ApiTags('kyc')
@Controller('guarantor')
export class PublicGuarantorController {
  constructor(private readonly guarantor: GuarantorService) {}

  @Get(':token')
  getContext(@Param('token') token: string) {
    return this.guarantor.getPublicContext(token);
  }

  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'idDocument', maxCount: 1 },
      { name: 'proofOfAddress', maxCount: 1 },
    ]),
  )
  @HttpCode(HttpStatus.OK)
  @Post(':token/submit')
  submit(
    @Param('token') token: string,
    @Body() dto: SubmitGuarantorDto,
    @UploadedFiles()
    files: { idDocument?: Express.Multer.File[]; proofOfAddress?: Express.Multer.File[] },
  ) {
    return this.guarantor.submit(token, dto, {
      idDocument: files.idDocument?.[0],
      proofOfAddress: files.proofOfAddress?.[0],
    });
  }
}
