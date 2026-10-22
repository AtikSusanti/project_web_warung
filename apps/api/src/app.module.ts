import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';

import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { ProductsModule } from './modules/products/products.module.js';
import { CategoriesModule } from './modules/categories/categories.module.js';
import { CustomersModule } from './modules/customers/customers.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { TransactionsModule } from './modules/transactions/transactions.module.js';
import { DebtsModule } from './modules/debts/debts.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { ShiftsModule } from './modules/shifts/shifts.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { StockModule } from './modules/stock/stock.module.js';
import { IdempotencyModule } from './modules/idempotency/idempotency.module.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { ResponseInterceptor } from './common/interceptors/response.interceptor.js';
import { LoggerModule } from './common/logger/logger.module.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { RolesGuard } from './common/guards/roles.guard.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    LoggerModule,
    PrismaModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    CategoriesModule,
    CustomersModule,
    OrdersModule,
    TransactionsModule,
    DebtsModule,
    SettingsModule,
    ShiftsModule,
    ReportsModule,
    HealthModule,
    AuditModule,
    StockModule,
    IdempotencyModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useClass: ValidationPipe,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}