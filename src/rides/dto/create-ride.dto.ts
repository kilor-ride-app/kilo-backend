import { ApiProperty } from '@nestjs/swagger';
import { RidePaymentMethod } from '@prisma/client';
import { IsEnum, IsLatitude, IsLongitude, IsOptional, IsString } from 'class-validator';

export class CreateRideDto {
  @ApiProperty({ example: 6.5244 })
  @IsLatitude()
  pickupLat: number;

  @ApiProperty({ example: 3.3792 })
  @IsLongitude()
  pickupLng: number;

  @ApiProperty({ example: '1 Allen Avenue, Ikeja, Lagos' })
  @IsString()
  pickupAddress: string;

  @ApiProperty({ example: 6.4531 })
  @IsLatitude()
  dropoffLat: number;

  @ApiProperty({ example: 3.3958 })
  @IsLongitude()
  dropoffLng: number;

  @ApiProperty({ example: 'Murtala Muhammed International Airport, Lagos' })
  @IsString()
  dropoffAddress: string;

  @ApiProperty({ example: 'ECONOMY' })
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
}
