import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsEmail, IsIn } from 'class-validator';

const BUSINESS_TEAM_ROLES = [UserRole.BUSINESS_ADMIN, UserRole.BUSINESS_STAFF] as const;

export class InviteTeamMemberDto {
  @ApiProperty({ example: 'teammate@company.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ enum: BUSINESS_TEAM_ROLES, example: UserRole.BUSINESS_STAFF })
  @IsIn(BUSINESS_TEAM_ROLES)
  role: (typeof BUSINESS_TEAM_ROLES)[number];
}
