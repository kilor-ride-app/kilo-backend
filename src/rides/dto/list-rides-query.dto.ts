import { ApiProperty } from '@nestjs/swagger';
import { RideStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { DateRangeQueryDto } from '../../common/dto/date-range-query.dto';

export class ListRidesQueryDto extends DateRangeQueryDto {
  @ApiProperty({ enum: RideStatus, required: false })
  @IsOptional()
  @IsEnum(RideStatus)
  status?: RideStatus;

  @ApiProperty({ required: false, description: 'Ride id prefix, or rider/driver name' })
  @IsOptional()
  @IsString()
  search?: string;
}
