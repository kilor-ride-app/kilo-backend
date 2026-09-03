import { ApiProperty } from '@nestjs/swagger';
import { UserStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../wallet/dto/pagination.dto';

export class ListUsersQueryDto extends PaginationDto {
  @ApiProperty({ required: false, description: 'Matches against name, email, or phone' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ enum: UserStatus, required: false })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
