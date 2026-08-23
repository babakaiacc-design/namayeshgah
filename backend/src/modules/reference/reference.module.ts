import { Module } from '@nestjs/common';

import {
  CategoriesController,
  CitiesController,
  VenuesController,
} from './reference.controller';
import { ReferenceService } from './reference.service';

@Module({
  controllers: [CategoriesController, VenuesController, CitiesController],
  providers: [ReferenceService],
  exports: [ReferenceService],
})
export class ReferenceModule {}
