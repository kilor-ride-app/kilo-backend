import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString, Length, Min } from 'class-validator';

export class WithdrawDto {
  @ApiProperty({ example: 5000, description: 'Amount in NGN (major unit, not kobo)' })
  @IsNumber()
  @Min(100)
  amount: number;

  @ApiProperty({ example: '0123456789', description: 'NUBAN account number' })
  @IsString()
  @Length(10, 10)
  accountNumber: string;

  @ApiProperty({
    example: '058',
    description: 'Paystack bank code, see GET https://api.paystack.co/bank',
  })
  @IsString()
  bankCode: string;
}
