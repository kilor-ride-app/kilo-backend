import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { StopInputDto } from './stop-input.dto';

// Replaces the full stop list in one call — add/edit/remove are all just
// "here is the new list", matching the plan's single POST endpoint for all
// three operations.
export class UpdateStopsDto {
  @ApiProperty({ type: [StopInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StopInputDto)
  stops: StopInputDto[];
}
