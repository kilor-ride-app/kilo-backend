import { ApiProperty } from '@nestjs/swagger';
import { IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateSolarAssessmentDto {
  @ApiProperty({ example: '14 Adeola Odeku Street, Victoria Island, Lagos' })
  @IsString()
  address: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsLatitude()
  lat?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsLongitude()
  lng?: number;

  @ApiProperty({ required: false, example: 45000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyBillEstimate?: number;

  @ApiProperty({ required: false, example: 'Residential' })
  @IsOptional()
  @IsString()
  propertyType?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}
