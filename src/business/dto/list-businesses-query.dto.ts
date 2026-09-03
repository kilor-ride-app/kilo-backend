import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../wallet/dto/pagination.dto';

export class ListBusinessesQueryDto extends PaginationDto {
  @ApiProperty({ required: false, description: 'Matches company name or contact email' })
  @IsOptional()
  @IsString()
  search?: string;
}
