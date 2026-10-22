import { Controller, Get } from '@nestjs/common';

import { Roles } from '../../common/decorators/roles.decorator.js';
import { AuditService } from './audit.service.js';

@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Roles('ADMIN')
  findAll() {
    return this.auditService.findAll();
  }
}
