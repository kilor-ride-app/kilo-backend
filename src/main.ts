import './instrument';

import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: true — needed to verify the Paystack webhook's HMAC signature
  // against the exact request bytes; Nest still also parses req.body as
  // JSON normally alongside it.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  app.use(helmet());
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean),
    credentials: true,
  });

  // Reject any request body that doesn't match its DTO — first line of
  // defense against malformed/malicious input (see plan.md Section 7).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api/v1', {
    // Public receiver-tracking endpoints (LogisticsModule) stay unprefixed —
    // both routes need listing explicitly, NestJS's prefix exclusion
    // matches route patterns exactly, not as a path prefix.
    exclude: ['health', 'track/:trackingToken', 'track/:trackingToken/otp/verify'],
  });

  // Swagger/OpenAPI — generated from controller/DTO decorators, so it
  // can't drift from the real API the way a hand-maintained doc would.
  // Not mounted in production by default (internal API surface + auth
  // flows shouldn't be publicly browsable) — gate behind an env flag.
  if (process.env.ENABLE_SWAGGER !== 'false') {
    const config = new DocumentBuilder()
      .setTitle('Kilo API')
      .setDescription(
        'Kilo mobility, logistics, and energy platform — Rider, Driver, and Admin API surface. See kilo-backend-plan.md Section 2 for the full endpoint spec this implements.',
      )
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'access-token', // referenced via @ApiBearerAuth('access-token') on protected controllers
      )
      .addTag('accounts', 'Auth & onboarding')
      .addTag('kyc', 'Driver KYC verification')
      .addTag('service-areas', 'Geofencing & service area config')
      .addTag('wallet', 'Wallet, ledger, payments')
      .addTag('pricing', 'Tariffs & commission config')
      .addTag('rides', 'Ride booking, dispatch, trips, cancellation')
      .addTag('logistics', 'Package/freight delivery')
      .addTag('kilowatt', 'Charging, battery swap, solar')
      .addTag('business', 'Business accounts & invoicing')
      .addTag('promo', 'Promo codes')
      .addTag('partnerships', 'Referrals, fleet partners, partner offers')
      .addTag('notifications', 'In-app, push, SMS, email')
      .addTag('support', 'Support tickets')
      .addTag('admin-ops', 'Admin dashboard')
      .addTag('reports', 'Reporting & analytics')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true, // keeps the bearer token filled in across page reloads while testing
      },
    });
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Kilo backend listening on port ${port}`);
  if (process.env.ENABLE_SWAGGER !== 'false') {
    // eslint-disable-next-line no-console
    console.log(`API docs available at http://localhost:${port}/docs`);
  }
}

bootstrap();
