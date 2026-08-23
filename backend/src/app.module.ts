import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { dataSourceOptions } from './database/data-source';
import { HealthModule } from './modules/health/health.module';

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

    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
