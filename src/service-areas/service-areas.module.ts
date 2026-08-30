import { Module } from '@nestjs/common';
import { AdminServiceAreasController } from './admin-service-areas.controller';
import { ServiceAreasController } from './service-areas.controller';
import { ServiceAreasService } from './service-areas.service';

@Module({
  controllers: [ServiceAreasController, AdminServiceAreasController],
  providers: [ServiceAreasService],
  exports: [ServiceAreasService],
})
export class ServiceAreasModule {}
