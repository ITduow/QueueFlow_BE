import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { UsersService } from '../users/users.service';

@Injectable()
export class WebsocketAuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  async authenticate(rawToken: unknown): Promise<AuthenticatedUser | null> {
    if (typeof rawToken !== 'string' || !rawToken.trim()) return null;
    const token = rawToken.startsWith('Bearer ') ? rawToken.slice(7) : rawToken;
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
      const user = await this.users.findById(payload.sub);
      return user?.isActive ? user : null;
    } catch {
      return null;
    }
  }
}
