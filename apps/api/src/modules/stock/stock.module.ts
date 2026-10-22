import { Module } from '@nestjs/common';

import { StockService } from './services/stock.service.js';

@Module({
  providers: [StockService],
  exports: [StockService],
})
export class StockModule {}