import { Module } from '@nestjs/common';
import { DriverProfilesService } from './driver-profiles.service';
import { DriversController } from './drivers.controller';

// Exported so Rides and Logistics can attach the driver card (rating,
// trips, vehicle) to the trip views they return to riders.
@Module({
  controllers: [DriversController],
  providers: [DriverProfilesService],
  exports: [DriverProfilesService],
})
export class DriversModule {}
