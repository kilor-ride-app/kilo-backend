import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min } from 'class-validator';

export class TopUpDto {
  @ApiProperty({ example: 5000, description: 'Amount in NGN (major unit, not kobo)' })
  @IsNumber()
  @Min(100)
  amount: number;
}
