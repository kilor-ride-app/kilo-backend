import { ApiProperty, IntersectionType, OmitType } from '@nestjs/swagger';
import { TicketPriority, TicketStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { DateRangeQueryDto } from '../../common/dto/date-range-query.dto';
import { ExportFormatDto } from '../../common/export/export-format.dto';

// `from`/`to` (inherited) filter on the date the ticket was opened.
export class ListTicketsQueryDto extends DateRangeQueryDto {
  @ApiProperty({ enum: TicketStatus, required: false })
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @ApiProperty({ enum: TicketPriority, required: false })
  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  assignedToId?: string;
}

export class ExportTicketsQueryDto extends IntersectionType(
  OmitType(ListTicketsQueryDto, ['take', 'skip'] as const),
  ExportFormatDto,
) {}
