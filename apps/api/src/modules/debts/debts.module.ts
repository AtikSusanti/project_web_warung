import { Module } from '@nestjs/common';

import { IdempotencyModule } from '../idempotency/idempotency.module.js';
import { CustomerDebtsController } from './customer-debts.controller.js';
import { DebtsController } from './debts.controller.js';
import { DebtsService } from './debts.service.js';

@Module({
  imports: [IdempotencyModule],
  controllers: [DebtsController, CustomerDebtsController],
  providers: [DebtsService],
})
export class DebtsModule {}
