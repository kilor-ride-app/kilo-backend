import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AppleModule } from '../integrations/apple/apple.module';
import { EmailModule } from '../integrations/email/email.module';
import { GoogleModule } from '../integrations/google/google.module';
import { SmsModule } from '../integrations/sms/sms.module';
import { AdminInvitesController } from './admin-invites.controller';
import { AdminPermissionsController, AdminRolesController } from './admin-roles.controller';
import { AdminStaffController } from './admin-staff.controller';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { InvitesService } from './invites.service';
import { OtpService } from './otp.service';
import { RolesService } from './roles.service';
import { SocialAuthController } from './social-auth.controller';
import { SocialAuthService } from './social-auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    PassportModule,
    SmsModule,
    EmailModule,
    GoogleModule,
    AppleModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m',
        },
      }),
    }),
  ],
  controllers: [
    AuthController,
    UsersController,
    AdminStaffController,
    AdminInvitesController,
    AdminRolesController,
    AdminPermissionsController,
    SocialAuthController,
  ],
  providers: [
    AuthService,
    UsersService,
    InvitesService,
    RolesService,
    JwtStrategy,
    OtpService,
    EmailVerificationService,
    SocialAuthService,
  ],
  // AuthService exported specifically so BusinessModule can issue a token
  // pair when a business team invite is accepted, mirroring
  // InvitesService's exact accept-flow shape.
  exports: [AuthService],
})
export class AccountsModule {}
