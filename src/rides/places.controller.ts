import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GoogleMapsService } from '../integrations/google-maps/google-maps.service';
import {
  AutocompleteQueryDto,
  PlaceDetailsQueryDto,
  ReverseGeocodeQueryDto,
} from './dto/autocomplete-query.dto';

@ApiTags('rides')
@Controller('places')
export class PlacesController {
  constructor(private readonly maps: GoogleMapsService) {}

  @Get('autocomplete')
  autocomplete(@Query() query: AutocompleteQueryDto) {
    const near =
      query.lat !== undefined && query.lng !== undefined
        ? { lat: query.lat, lng: query.lng }
        : undefined;
    return this.maps.autocomplete(query.query, near);
  }

  // Resolve a picked suggestion to the address + coordinates booking needs.
  @Get('details')
  details(@Query() query: PlaceDetailsQueryDto) {
    return this.maps.placeDetails(query.placeId);
  }

  @Get('reverse-geocode')
  reverseGeocode(@Query() query: ReverseGeocodeQueryDto) {
    return this.maps.reverseGeocode(query.lat, query.lng);
  }
}
