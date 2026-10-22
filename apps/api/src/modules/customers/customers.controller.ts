import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';

import { Roles } from '../../common/decorators/roles.decorator.js';
import { CustomersService } from './customers.service.js';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/index.js';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  @Roles('ADMIN', 'CASHIER')
  create(@Body() dto: CreateCustomerDto) {
    return this.customersService.create(dto);
  }

  @Get()
  @Roles('ADMIN', 'CASHIER')
  findAll() {
    return this.customersService.findAll();
  }

  @Get(':id')
  @Roles('ADMIN', 'CASHIER')
  findOne(@Param('id') id: string) {
    return this.customersService.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customersService.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.customersService.remove(id);
  }
}