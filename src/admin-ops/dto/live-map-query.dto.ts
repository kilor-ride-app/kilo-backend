import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class LiveMapQueryDto {
  @ApiPropertyOptional({
    description: 'State/region name to scope the fleet to, or "all" for nationwide. Best-effort.',
    example: 'Lagos',
  })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({
    description: 'Viewport bounding box as "minLat,minLng,maxLat,maxLng"',
    example: '6.3,3.1,6.7,3.6',
  })
  @IsOptional()
  @IsString()
  bounds?: string;
}
