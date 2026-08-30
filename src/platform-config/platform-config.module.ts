import { Module } from '@nestjs/common';
import { PlatformConfigService } from './platform-config.service';

@Module({
  providers: [PlatformConfigService],
  exports: [PlatformConfigService],
})
export class PlatformConfigModule {}
