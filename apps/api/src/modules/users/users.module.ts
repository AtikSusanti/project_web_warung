import { Module } from '@nestjs/common';

import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';
import { PasswordService } from '../auth/password.service.js';

@Module({
  controllers: [UsersController],
  providers: [UsersService, PasswordService],
  exports: [UsersService],
})
export class UsersModule {}