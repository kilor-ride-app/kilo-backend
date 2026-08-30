import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class AutocompleteQueryDto {
  @ApiProperty({ example: 'Ikeja City Mall' })
  @IsString()
  @MinLength(2)
  query: string;
}
