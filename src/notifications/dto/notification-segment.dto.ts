import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ArrayNotEmpty, IsArray, IsEnum, IsOptional, IsUUID } from 'class-validator';

export class NotificationSegmentDto {
  @ApiProperty({ enum: UserRole, required: false, description: 'Every user with this role' })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiProperty({ type: [String], required: false, description: 'Specific user IDs' })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  userIds?: string[];
}
