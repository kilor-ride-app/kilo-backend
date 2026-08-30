import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateCommissionRuleDto {
  @ApiProperty({ example: 'RIDE', description: 'Free-form — e.g. RIDE, DELIVERY, KILOWATT' })
  @IsString()
  serviceType: string;

  @ApiProperty({ required: false, example: 'ECONOMY' })
  @IsOptional()
  @IsString()
  vehicleType?: string;

  @ApiProperty({ example: 0.18, description: 'Fraction, e.g. 0.18 = 18%' })
  @IsNumber()
  @Min(0)
  @Max(1)
  rate: number;
}
