import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class BroadcastDto {
  @ApiProperty({ example: 'Scheduled maintenance' })
  @IsString()
  title: string;

  @ApiProperty({ example: 'The app will be briefly unavailable tonight at 2am WAT.' })
  @IsString()
  body: string;

  @ApiProperty({ example: 'SYSTEM' })
  @IsString()
  category: string;
}
