import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ResolveTicketDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  resolutionNote?: string;
}
