import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RidesService } from './rides.service';

// No auth — the share token is the credential, same model as the public
// delivery tracking route. Unprefixed via main.ts's global-prefix exclusion.
@ApiTags('rides')
@Controller('track/ride')
export class PublicRideTrackingController {
  constructor(private readonly rides: RidesService) {}

  @Get(':shareToken')
  track(@Param('shareToken') shareToken: string) {
    return this.rides.getSharedRide(shareToken);
  }
}
