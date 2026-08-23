import { Module } from '@nestjs/common';

import {
  DefaultFetcherFactory,
  FETCHER_FACTORY,
} from '../../common/http/fetcher.factory';
import { ChangeProcessor } from './change-processor';
import { SyncController } from './sync.controller';
import { SyncSecretGuard } from './sync-secret.guard';
import { SyncService } from './sync.service';

@Module({
  controllers: [SyncController],
  providers: [
    SyncService,
    ChangeProcessor,
    SyncSecretGuard,
    // Substituted in tests so adapters read saved fixtures instead of the
    // network, and the seam the Iran relay will plug into.
    { provide: FETCHER_FACTORY, useClass: DefaultFetcherFactory },
  ],
  exports: [SyncService, ChangeProcessor],
})
export class SyncModule {}
