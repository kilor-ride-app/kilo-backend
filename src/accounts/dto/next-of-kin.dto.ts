import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsPhoneNumber, IsString, MaxLength } from 'class-validator';

export class NextOfKinDto {
  @ApiProperty({ example: 'Chioma Okafor' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fullName: string;

  // Validated as a Nigerian number when no country code is given, so the
  // design's local "0812 345 6789" format is accepted as-is.
  @ApiProperty({ example: '+2348123456789' })
  @IsPhoneNumber('NG')
  phone: string;
}
