import { Body, Controller, Get, Patch, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PasswordService } from '../auth/password.service';
import { RefreshCookieService } from '../common/security/refresh-cookie.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly refreshCookie: RefreshCookieService,
  ) {}

  @Get('me')
  getProfile(@CurrentUser('id') userId: string) {
    return this.usersService.getProfile(userId);
  }

  @Patch('me')
  updateProfile(@CurrentUser('id') userId: string, @Body() dto: UpdateProfileDto) {
    if (Object.keys(dto).length === 0) return this.usersService.rejectEmptyProfileUpdate();
    return this.usersService.updateProfile(userId, dto);
  }

  @Patch('me/password')
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.usersService.changePassword(userId, dto, this.passwordService);
    this.refreshCookie.clear(response);
    return { message: 'Password changed successfully. Please log in again.' };
  }
}
