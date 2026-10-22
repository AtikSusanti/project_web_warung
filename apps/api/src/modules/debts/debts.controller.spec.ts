import 'reflect-metadata';

import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@warung/shared';
import { describe, expect, it } from 'vitest';

import { RolesGuard } from '../../common/guards/roles.guard.js';
import { CustomerDebtsController } from './customer-debts.controller.js';
import { DebtsController } from './debts.controller.js';

type Handler = (...args: never[]) => unknown;

function context(role: UserRole, handler: Handler, controller: object): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => ({ user: { role } }),
    }),
  } as unknown as ExecutionContext;
}

const findReceivables = DebtsController.prototype.findReceivables as unknown as Handler;
const aging = DebtsController.prototype.aging as unknown as Handler;
const findCustomerDebts = CustomerDebtsController.prototype.findCustomerDebts as unknown as Handler;

describe('DebtsController access', () => {
  const guard = new RolesGuard(new Reflector());

  it('mengizinkan ADMIN dan CASHIER melihat daftar piutang', () => {
    expect(guard.canActivate(context('ADMIN', findReceivables, DebtsController))).toBe(true);
    expect(guard.canActivate(context('CASHIER', findReceivables, DebtsController))).toBe(true);
    expect(guard.canActivate(context('ADMIN', findCustomerDebts, CustomerDebtsController))).toBe(
      true,
    );
    expect(guard.canActivate(context('CASHIER', findCustomerDebts, CustomerDebtsController))).toBe(
      true,
    );
  });

  it('membatasi laporan umur piutang hanya untuk ADMIN', () => {
    expect(guard.canActivate(context('ADMIN', aging, DebtsController))).toBe(true);
    expect(() => guard.canActivate(context('CASHIER', aging, DebtsController))).toThrow(
      ForbiddenException,
    );
  });
});
