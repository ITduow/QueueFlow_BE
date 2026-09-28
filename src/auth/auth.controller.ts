import { Controller, Body, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { REFRESH_TOKEN_COOKIE } from './constants/auth.constants';
import { RefreshCookieService } from '../common/security/refresh-cookie.service';

type AuthRequest = Request;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly refreshCookie: RefreshCookieService,
  ) {}

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(dto, this.metadata(request));
    this.refreshCookie.set(response, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Public()
  @Post('refresh')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth(REFRESH_TOKEN_COOKIE)
  async refresh(@Req() request: AuthRequest, @Res({ passthrough: true }) response: Response) {
    const result = await this.authService.refresh(
      this.refreshToken(request),
      this.metadata(request),
    );
    this.refreshCookie.set(response, result.refreshToken);
    return { accessToken: result.accessToken };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() request: AuthRequest, @Res({ passthrough: true }) response: Response) {
    await this.authService.logout(this.refreshToken(request));
    this.refreshCookie.clear(response);
    return { message: 'Logged out successfully.' };
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  async logoutAll(
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.logoutAll(userId);
    this.refreshCookie.clear(response);
    return { message: 'All sessions have been logged out.' };
  }

  @Get('me')
  async me(@CurrentUser('id') userId: string) {
    return this.authService.me(userId);
  }

  private metadata(request: AuthRequest) {
    return { userAgent: request.get('user-agent') ?? null, ipAddress: request.ip ?? null };
  }

  private refreshToken(request: AuthRequest): string | undefined {
    const token = request.cookies?.[REFRESH_TOKEN_COOKIE];
    return typeof token === 'string' ? token : undefined;
  }
}
