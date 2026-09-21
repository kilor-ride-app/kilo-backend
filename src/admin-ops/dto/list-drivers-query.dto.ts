import { ApiProperty, IntersectionType, OmitType } from '@nestjs/swagger';
import { DriverAvailability } from '@prisma/client';
import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { ExportFormatDto } from '../../common/export/export-format.dto';
import { ListUsersQueryDto } from './list-users-query.dto';

// Review state of a driver's uploaded KYC documents (latest submission per
// document type). NOT_SUBMITTED = no documents uploaded yet.
export const DRIVER_KYC_STATES = ['PENDING', 'APPROVED', 'REJECTED', 'NOT_SUBMITTED'] as const;
export type DriverKycState = (typeof DRIVER_KYC_STATES)[number];

export class ListDriversQueryDto extends ListUsersQueryDto {
  @ApiProperty({
    enum: DriverAvailability,
    required: false,
    description: 'Filter by current dispatch availability',
  })
  @IsOptional()
  @IsEnum(DriverAvailability)
  availability?: DriverAvailability;

  @ApiProperty({
    enum: DRIVER_KYC_STATES,
    required: false,
    description: 'Filter by KYC review state (PENDING = awaiting admin review)',
  })
  @IsOptional()
  @IsIn(DRIVER_KYC_STATES)
  kycStatus?: DriverKycState;
}

export class ExportDriversQueryDto extends IntersectionType(
  OmitType(ListDriversQueryDto, ['take', 'skip'] as const),
  ExportFormatDto,
) {}
