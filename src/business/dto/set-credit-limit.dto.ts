import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min } from 'class-validator';

export class SetCreditLimitDto {
  @ApiProperty({ example: 500000 })
  @IsNumber()
  @Min(0)
  creditLimit: number;
}
