import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { STAFF_STATUS_FILTERS, StaffStatusFilter } from './list-staff-query.dto';

export class UpdateStaffDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Role IDs to grant (replaces the current set).',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  roleIds?: string[];

  @ApiPropertyOptional({ enum: STAFF_STATUS_FILTERS })
  @IsOptional()
  @IsIn(STAFF_STATUS_FILTERS)
  status?: StaffStatusFilter;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Permission keys granted directly to this user, on top of their roles (replaces the current set). Valid keys come from GET /admin/permissions.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionKeys?: string[];
}
