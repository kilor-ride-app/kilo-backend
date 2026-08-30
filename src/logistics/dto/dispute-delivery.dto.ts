import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class DisputeDeliveryDto {
  @ApiProperty({ example: 'Package confirmed damaged in transit — refunding sender' })
  @IsString()
  resolution: string;

  // If true and the delivery has a linked wallet transaction, that
  // transaction is reversed as part of resolving the dispute.
  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  refund?: boolean;
}
