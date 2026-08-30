import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { CreateDeliveryDto } from '../../logistics/dto/create-delivery.dto';

// Bulk booking, billed to the business's credit line — paymentMethod on
// each item is ignored (business-billed deliveries never use WALLET/CASH).
// Deliberately not a recurring-schedule engine: this creates every
// delivery immediately, once. See PROGRESS.md for the scope note.
export class ScheduleDeliveriesDto {
  @ApiProperty({ type: [CreateDeliveryDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateDeliveryDto)
  deliveries: CreateDeliveryDto[];
}
