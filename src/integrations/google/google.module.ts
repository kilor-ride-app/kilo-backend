import { Module } from '@nestjs/common';
import { GoogleTokenVerifier } from './google-token-verifier.service';

@Module({
  providers: [GoogleTokenVerifier],
  exports: [GoogleTokenVerifier],
})
export class GoogleModule {}
