import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { RefreshCookieService } from '../common/security/refresh-cookie.service';
import { UsersController } from './users.controller';
import { AdminUsersController } from './admin-users.controller';
import { PasswordService } from '../auth/password.service';

@Module({
  controllers: [UsersController, AdminUsersController],
  providers: [UsersService, RefreshCookieService, PasswordService],
  exports: [UsersService],
})
export class UsersModule {}
