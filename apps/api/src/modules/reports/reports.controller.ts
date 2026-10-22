import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { Roles } from '../../common/decorators/roles.decorator.js';
import { ReportsService } from './reports.service.js';

const dashboardQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const salesReportQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  groupBy: z.enum(['day', 'week', 'month', 'category', 'product', 'paymentMethod']).default('day'),
});

@Controller('reports')
@Roles('ADMIN')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('dashboard')
  dashboard(@Query() query: unknown) {
    const { from, to } = dashboardQuerySchema.parse(query);
    return this.reportsService.dashboard();
  }

  @Get('sales')
  sales(@Query() query: unknown) {
    const { from, to, groupBy } = salesReportQuerySchema.parse(query);
    return this.reportsService.sales(from, to, groupBy);
  }
}
