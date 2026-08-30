import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreatePartnerOfferDto } from './create-partner-offer.dto';

export class UpdatePartnerOfferDto extends PartialType(CreatePartnerOfferDto) {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
