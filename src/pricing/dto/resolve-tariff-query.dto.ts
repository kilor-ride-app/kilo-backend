import { ApiProperty } from '@nestjs/swagger';
import { TariffServiceType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

export class ResolveTariffQueryDto {
  @ApiProperty({ example: 'ECONOMY' })
  @IsString()
  vehicleType: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  serviceAreaId?: string;

  @ApiProperty({ required: false, enum: TariffServiceType })
  @IsOptional()
  @IsEnum(TariffServiceType)
  serviceType?: TariffServiceType;
}
