import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GoogleMapsService } from '../integrations/google-maps/google-maps.service';
import { AutocompleteQueryDto } from './dto/autocomplete-query.dto';

@ApiTags('rides')
@Controller('places')
export class PlacesController {
  constructor(private readonly maps: GoogleMapsService) {}

  @Get('autocomplete')
  autocomplete(@Query() query: AutocompleteQueryDto) {
    return this.maps.autocomplete(query.query);
  }
}
