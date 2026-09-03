import { ApiProperty } from '@nestjs/swagger';
import { DriverAvailability } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { ListUsersQueryDto } from './list-users-query.dto';

export class ListDriversQueryDto extends ListUsersQueryDto {
  @ApiProperty({
    enum: DriverAvailability,
    required: false,
    description: 'Filter by current dispatch availability',
  })
  @IsOptional()
  @IsEnum(DriverAvailability)
  availability?: DriverAvailability;
}
