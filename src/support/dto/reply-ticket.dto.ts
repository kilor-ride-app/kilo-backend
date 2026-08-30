import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ReplyTicketDto {
  @ApiProperty()
  @IsString()
  body: string;
}
