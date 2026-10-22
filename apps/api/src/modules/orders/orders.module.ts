import { Module } from '@nestjs/common';

import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { DocumentSequenceService } from './document-sequence.service.js';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, DocumentSequenceService],
  exports: [OrdersService, DocumentSequenceService],
})
export class OrdersModule {}
