import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@warung/shared';

import { ROLES_KEY } from '../decorators/roles.decorator.js';
import type { RequestWithUser } from '../types.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<RequestWithUser>();
    if (!user?.role) throw new ForbiddenException('Akses ditolak');

    const allowed = requiredRoles.includes(user.role);
    if (!allowed) throw new ForbiddenException('Akses ditolak');
    return true;
  }
}