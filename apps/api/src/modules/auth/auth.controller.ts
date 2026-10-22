import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { Public } from '../../common/decorators/public.decorator.js';
import { getClientIp, getUserAgent } from '../../common/types.js';
import { AuthService } from './auth.service.js';
import { LoginDto, RefreshDto } from './dto/index.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const tokens = await this.authService.login(dto.username, dto.password, getClientIp(req), getUserAgent(req));
    return tokens;
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    const tokens = await this.authService.refresh(dto.refreshToken, getClientIp(req), getUserAgent(req));
    return tokens;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshDto) {
    await this.authService.logout(dto.refreshToken);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(@Req() req: any) {
    const userId = req.user?.sub;
    if (userId) await this.authService.logoutAll(userId);
  }
}