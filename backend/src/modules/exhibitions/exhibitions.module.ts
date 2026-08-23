import { Module } from '@nestjs/common';

import { ExhibitionsController } from './exhibitions.controller';
import { ExhibitionsRepository } from './exhibitions.repository';
import { ExhibitionsService } from './exhibitions.service';

@Module({
  controllers: [ExhibitionsController],
  providers: [ExhibitionsService, ExhibitionsRepository],
  exports: [ExhibitionsService, ExhibitionsRepository],
})
export class ExhibitionsModule {}
