import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ServiceAreasService } from './service-areas.service';
import { ValidateLocationDto } from './dto/validate-location.dto';

// Public, unauthenticated — coverage checks need to work pre-signup (e.g. a
// "do you operate here?" landing page) as well as inside the ride-booking flow.
@ApiTags('service-areas')
@Controller('service-areas')
export class ServiceAreasController {
  constructor(private readonly serviceAreasService: ServiceAreasService) {}

  @HttpCode(HttpStatus.OK)
  @Post('validate')
  validate(@Body() dto: ValidateLocationDto) {
    return this.serviceAreasService.validateLocation(dto.lat, dto.lng);
  }

  @Get()
  list() {
    return this.serviceAreasService.list();
  }
}
