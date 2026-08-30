import { ApiProperty } from '@nestjs/swagger';
import { DriverAvailability, DriverServiceMode } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class DriverStatusDto {
  @ApiProperty({ enum: DriverAvailability, example: DriverAvailability.ONLINE })
  @IsEnum(DriverAvailability)
  availability: DriverAvailability;

  @ApiProperty({ required: false, example: 'ECONOMY' })
  @IsOptional()
  @IsString()
  vehicleType?: string;

  // Ride-mode drivers only ever see ride offers; logistics-mode drivers
  // only ever see delivery offers — same online pool, same socket
  // connection, one line of work at a time.
  @ApiProperty({ enum: DriverServiceMode, required: false, example: DriverServiceMode.RIDES })
  @IsOptional()
  @IsEnum(DriverServiceMode)
  serviceMode?: DriverServiceMode;
}
