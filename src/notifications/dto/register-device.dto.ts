import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

const PLATFORMS = ['ios', 'android', 'web'] as const;

export class RegisterDeviceDto {
  @ApiProperty({ description: 'FCM device token' })
  @IsString()
  token: string;

  @ApiProperty({ enum: PLATFORMS })
  @IsIn(PLATFORMS)
  platform: (typeof PLATFORMS)[number];
}
