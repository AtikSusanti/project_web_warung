import { Body, Controller, Get, Patch } from '@nestjs/common';

import { Roles } from '../../common/decorators/roles.decorator.js';
import { SettingsService } from './settings.service.js';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  get() {
    return this.settingsService.get();
  }

  @Patch()
  @Roles('ADMIN')
  update(@Body() body: any) {
    return this.settingsService.update(body);
  }
}