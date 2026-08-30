import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { NotificationChannel } from '@prisma/client';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsString,
  ValidateNested,
} from 'class-validator';

class PreferenceUpdate {
  @ApiProperty({ example: 'RIDE' })
  @IsString()
  category: string;

  @ApiProperty({ enum: NotificationChannel })
  @IsEnum(NotificationChannel)
  channel: NotificationChannel;

  @ApiProperty()
  @IsBoolean()
  enabled: boolean;
}

export class UpdatePreferencesDto {
  @ApiProperty({ type: [PreferenceUpdate] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PreferenceUpdate)
  preferences: PreferenceUpdate[];
}
