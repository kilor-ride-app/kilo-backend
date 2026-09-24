import { Module } from '@nestjs/common';
import { DriversModule } from '../drivers/drivers.module';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';

@Module({
  imports: [DriversModule],
  controllers: [ActivityController],
  providers: [ActivityService],
})
export class ActivityModule {}
