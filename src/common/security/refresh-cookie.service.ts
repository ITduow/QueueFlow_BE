import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CookieOptions, Response } from 'express';
import { REFRESH_TOKEN_COOKIE } from '../../auth/constants/auth.constants';

@Injectable()
export class RefreshCookieService {
  constructor(private readonly config: ConfigService) {}

  set(response: Response, token: string): void {
    response.cookie(REFRESH_TOKEN_COOKIE, token, this.options());
  }

  clear(response: Response): void {
    response.clearCookie(REFRESH_TOKEN_COOKIE, this.options());
  }

  private options(): CookieOptions {
    const sameSite = this.config.get<'lax' | 'strict' | 'none'>('COOKIE_SAME_SITE', 'lax');
    const domain = this.config.get<string>('COOKIE_DOMAIN');
    return {
      httpOnly: true,
      secure: this.config.get<boolean>('COOKIE_SECURE', false),
      sameSite,
      path: `/${this.config.get<string>('API_PREFIX', 'api')}/v${this.config.get<string>('API_VERSION', '1')}/auth`,
      ...(domain ? { domain } : {}),
    };
  }
}
