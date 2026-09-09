import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SolarLeadStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEmail, IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateSolarLeadDto {
  @ApiProperty({ example: 'Adaeze Umeh' })
  @IsString()
  name: string;

  @ApiProperty({ example: '+2348032210091' })
  @IsString()
  phone: string;

  @ApiPropertyOptional({ example: 'adaeze.umeh@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ example: 'Surulere, Lagos' })
  @IsString()
  location: string;

  @ApiPropertyOptional({ example: 'Duplex' })
  @IsOptional()
  @IsString()
  propertyType?: string;

  @ApiPropertyOptional({ example: 8, description: 'System size in kW' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  systemSize?: number;

  @ApiPropertyOptional({ example: 'Partial home' })
  @IsOptional()
  @IsString()
  energyNeed?: string;

  @ApiPropertyOptional({ enum: SolarLeadStatus })
  @IsOptional()
  @IsEnum(SolarLeadStatus)
  status?: SolarLeadStatus;

  @ApiPropertyOptional({ description: 'Staff user ID to assign this lead to' })
  @IsOptional()
  @IsString()
  assignedToId?: string;
}
