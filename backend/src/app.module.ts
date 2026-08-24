import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { dataSourceOptions } from './database/data-source';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { ExhibitionsModule } from './modules/exhibitions/exhibitions.module';
import { FavoritesModule } from './modules/favorites/favorites.module';
import { HealthModule } from './modules/health/health.module';
import { ReferenceModule } from './modules/reference/reference.module';
import { RemindersModule } from './modules/reminders/reminders.module';
import { SyncModule } from './modules/sync/sync.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
      cache: true,
    }),

    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get<string>('app.logLevel', 'info'),
          transport: config.get<boolean>('app.isProduction')
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true } },
          // Never let a secret reach the logs.
          redact: ['req.headers.authorization', 'req.headers["x-sync-secret"]'],
        },
      }),
    }),

    TypeOrmModule.forRoot({
      ...dataSourceOptions,
      // Supabase pauses idle free projects and Render cold-starts the service,
      // so the first connection can legitimately fail. Retry instead of
      // crash-looping the container.
      retryAttempts: 10,
      retryDelay: 3000,
      autoLoadEntities: true,
    }),

    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),

    DatabaseModule,
    AuthModule,
    HealthModule,
    ExhibitionsModule,
    ReferenceModule,
    RemindersModule,
    FavoritesModule,
    SyncModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Applied globally, then relaxed per endpoint with @AllowGuest(). Making
    // authentication the default means a new endpoint cannot leak by omission.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
