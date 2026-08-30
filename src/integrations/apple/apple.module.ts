import { Module } from '@nestjs/common';
import { AppleTokenVerifier } from './apple-token-verifier.service';

@Module({
  providers: [AppleTokenVerifier],
  exports: [AppleTokenVerifier],
})
export class AppleModule {}
