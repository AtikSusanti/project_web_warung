import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { type TransactionQuery, transactionQuerySchema } from '@warung/shared';

import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import type { JwtPayload } from '../../common/jwt-payload.js';
import { CreateTransactionDto } from './dto/create-transaction.dto.js';
import { TransactionsService } from './transactions.service.js';

function parseTransactionQuery(query: unknown): TransactionQuery {
  const parsed = transactionQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Query transaksi tidak valid',
      details: {
        query: parsed.error.issues.map(
          (issue) => `${issue.path.join('.') || 'query'}: ${issue.message}`,
        ),
      },
    });
  }
  return parsed.data;
}

@Controller('transactions')
@Roles('ADMIN', 'CASHIER')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateTransactionDto, @CurrentUser() user: JwtPayload) {
    return this.transactionsService.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: unknown) {
    return this.transactionsService.findAll(parseTransactionQuery(query));
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.transactionsService.findOne(id);
  }
}
