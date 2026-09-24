import { ApiProperty } from '@nestjs/swagger';
import { DeliveryServiceType, PackageSize, RidePaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Max,
  MaxLength,
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

  @ApiProperty({
    enum: DeliveryServiceType,
    required: false,
    default: DeliveryServiceType.PACKAGE,
    description: 'PACKAGE for same-day parcels, FREIGHT for bulk/heavy loads',
  })
  @IsOptional()
  @IsEnum(DeliveryServiceType)
  serviceType?: DeliveryServiceType;

  @ApiProperty({ example: 'Sealed envelope, documents' })
  @IsString()
  packageDescription: string;

  @ApiProperty({ required: false, example: 3 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  weightKg?: number;

  @ApiProperty({ required: false, enum: PackageSize })
  @IsOptional()
  @IsEnum(PackageSize)
  packageSize?: PackageSize;

  @ApiProperty({ required: false, default: false, description: 'Handle with care' })
  @IsOptional()
  @IsBoolean()
  isFragile?: boolean;

  @ApiProperty({ required: false, example: 'Call the receiver on arrival' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  deliveryNotes?: string;

  @ApiProperty({
    required: false,
    example: '2026-10-01T13:00:00+01:00',
    description:
      'Book now, pick up later ("Schedule for later"). 30 minutes to 30 days ahead; omit for an immediate pickup.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduledFor?: Date;

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

  @ApiProperty({
    enum: RidePaymentMethod,
    required: false,
    default: RidePaymentMethod.WALLET,
    description:
      "BUSINESS_INVOICE bills the sender's business credit line (business accounts only)",
  })
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
