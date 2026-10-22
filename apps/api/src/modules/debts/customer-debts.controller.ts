import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';

import { Roles } from '../../common/decorators/roles.decorator.js';
import { DebtsService } from './debts.service.js';

@Controller('customers')
@Roles('ADMIN', 'CASHIER')
export class CustomerDebtsController {
  constructor(private readonly debtsService: DebtsService) {}

  @Get(':id/debts')
  findCustomerDebts(@Param('id', ParseUUIDPipe) id: string) {
    return this.debtsService.findCustomerDebts(id);
  }
}
