import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsIn } from 'class-validator';

export class GeoJsonPolygonDto {
  @ApiProperty({ enum: ['Polygon'], example: 'Polygon' })
  @IsIn(['Polygon'])
  type: 'Polygon';

  // GeoJSON order: [lng, lat], not [lat, lng]. One ring (no holes) for MVP —
  // [[[lng, lat], [lng, lat], ..., [lng, lat]]], first and last point equal.
  @ApiProperty({
    description: 'Single outer ring: [[[lng, lat], ...]]. Auto-closed if the ring is left open.',
    example: [
      [
        [3.3792, 6.5244],
        [3.42, 6.5244],
        [3.42, 6.56],
        [3.3792, 6.56],
        [3.3792, 6.5244],
      ],
    ],
  })
  @IsArray()
  coordinates: number[][][];
}
