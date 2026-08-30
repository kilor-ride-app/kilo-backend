import { ApiProperty } from '@nestjs/swagger';
import { TicketPriority } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateTicketDto {
  @ApiProperty({ example: 'Payment not reflecting in wallet' })
  @IsString()
  subject: string;

  @ApiProperty({ example: 'payment' })
  @IsString()
  category: string;

  @ApiProperty({ example: "I topped up ₦5,000 but it hasn't shown up in my wallet." })
  @IsString()
  body: string;

  @ApiProperty({ enum: TicketPriority, required: false, default: TicketPriority.MEDIUM })
  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;
}
