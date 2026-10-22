import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  type AgingQuery,
  agingQuerySchema,
  type PayDebtInput,
  payDebtInputSchema,
  type ReceivableCustomerQuery,
  receivableCustomerQuerySchema,
} from '@warung/shared';

import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import type { JwtPayload } from '../../common/jwt-payload.js';
import { DebtsService } from './debts.service.js';

function parsePayDebtInput(body: unknown): PayDebtInput {
  const parsed = payDebtInputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Data pembayaran utang tidak valid',
      details: {
        body: parsed.error.issues.map(
          (issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`,
        ),
      },
    });
  }
  return parsed.data;
}

function parseReceivableQuery(query: unknown): ReceivableCustomerQuery {
  const parsed = receivableCustomerQuerySchema.safeParse(query ?? {});
  if (!parsed.success) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Query daftar piutang tidak valid',
      details: {
        query: parsed.error.issues.map(
          (issue) => `${issue.path.join('.') || 'query'}: ${issue.message}`,
        ),
      },
    });
  }
  return parsed.data;
}

function parseAgingQuery(query: unknown): AgingQuery {
  const parsed = agingQuerySchema.safeParse(query ?? {});
  if (!parsed.success) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Query laporan umur piutang tidak valid',
      details: {
        query: parsed.error.issues.map(
          (issue) => `${issue.path.join('.') || 'query'}: ${issue.message}`,
        ),
      },
    });
  }
  return parsed.data;
}

@Controller('debts')
@Roles('ADMIN', 'CASHIER')
export class DebtsController {
  constructor(private readonly debtsService: DebtsService) {}

  @Post('pay')
  @HttpCode(HttpStatus.CREATED)
  pay(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    return this.debtsService.pay(parsePayDebtInput(body), user.sub);
  }

  @Get('customers')
  findReceivables(@Query() query: unknown) {
    return this.debtsService.findReceivables(parseReceivableQuery(query));
  }

  @Get('aging')
  @Roles('ADMIN')
  aging(@Query() query: unknown) {
    return this.debtsService.agingReport(parseAgingQuery(query));
  }
}
