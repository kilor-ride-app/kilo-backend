import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class AssignTicketDto {
  @ApiProperty({ description: 'Staff user ID to assign this ticket to' })
  @IsString()
  assignedToId: string;
}
