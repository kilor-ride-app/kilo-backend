import { Module } from '@nestjs/common';
import { SmileIdentityService } from './smile-identity.service';

@Module({
  providers: [SmileIdentityService],
  exports: [SmileIdentityService],
})
export class SmileIdentityModule {}
