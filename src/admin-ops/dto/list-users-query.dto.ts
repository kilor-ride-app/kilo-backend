import { ApiProperty, IntersectionType, OmitType } from '@nestjs/swagger';
import { UserStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { DateRangeQueryDto } from '../../common/dto/date-range-query.dto';
import { ExportFormatDto } from '../../common/export/export-format.dto';

// `from`/`to` (inherited) filter on registration date.
export class ListUsersQueryDto extends DateRangeQueryDto {
  @ApiProperty({ required: false, description: 'Matches against name, email, or phone' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ enum: UserStatus, required: false })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

// Export takes the same filters but no page window — it exports every match.
export class ExportUsersQueryDto extends IntersectionType(
  OmitType(ListUsersQueryDto, ['take', 'skip'] as const),
  ExportFormatDto,
) {}
