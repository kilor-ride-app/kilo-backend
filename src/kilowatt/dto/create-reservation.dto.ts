import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class CreateReservationDto {
  @ApiProperty()
  @IsString()
  stationId: string;
}
