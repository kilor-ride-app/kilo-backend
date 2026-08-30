import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ResolveTariffQueryDto {
  @ApiProperty({ example: 'ECONOMY' })
  @IsString()
  vehicleType: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  serviceAreaId?: string;
}
