import { ExecutionContext, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { Observable } from 'rxjs';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    return isPublic ? true : super.canActivate(context);
  }

  handleRequest<TUser = AuthenticatedUser>(
    error: unknown,
    user: TUser | false | null,
    info?: unknown,
  ): TUser {
    if (error instanceof HttpException) throw error;
    if (error || !user) {
      throw new UnauthorizedException({
        code:
          info instanceof Error && info.name === 'TokenExpiredError'
            ? 'AUTH_ACCESS_TOKEN_EXPIRED'
            : 'AUTH_ACCESS_TOKEN_INVALID',
        message: 'Authentication is required.',
      });
    }
    return user as TUser;
  }
}
