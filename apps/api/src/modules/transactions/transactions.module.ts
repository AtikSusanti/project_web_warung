import { Module } from '@nestjs/common';

import { IdempotencyModule } from '../idempotency/idempotency.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { StockModule } from '../stock/stock.module.js';
import { TransactionsController } from './transactions.controller.js';
import { TransactionsService } from './transactions.service.js';

@Module({
  imports: [IdempotencyModule, OrdersModule, StockModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
})
export class TransactionsModule {}
