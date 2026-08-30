import { ApiProperty } from '@nestjs/swagger';
import { RidePaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { StopInputDto } from './stop-input.dto';

export class CreateDeliveryDto {
  @ApiProperty({ example: 6.5244 })
  @IsLatitude()
  pickupLat: number;

  @ApiProperty({ example: 3.3792 })
  @IsLongitude()
  pickupLng: number;

  @ApiProperty({ example: '1 Allen Avenue, Ikeja, Lagos' })
  @IsString()
  pickupAddress: string;

  @ApiProperty({ example: 'Sealed envelope, documents' })
  @IsString()
  packageDescription: string;

  @ApiProperty({ required: false, example: 15000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  packageValue?: number;

  @ApiProperty({ example: 'Chinedu Okafor' })
  @IsString()
  receiverName: string;

  @ApiProperty({ example: '+2348012345678', description: 'E.164 format' })
  @IsPhoneNumber()
  receiverPhone: string;

  @ApiProperty({ example: 'BIKE' })
  @IsString()
  vehicleType: string;

  @ApiProperty({ enum: RidePaymentMethod, required: false, default: RidePaymentMethod.WALLET })
  @IsOptional()
  @IsEnum(RidePaymentMethod)
  paymentMethod?: RidePaymentMethod;

  @ApiProperty({ required: false, example: 'WELCOME10' })
  @IsOptional()
  @IsString()
  promoCode?: string;

  @ApiProperty({ type: [StopInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StopInputDto)
  stops: StopInputDto[];
}
