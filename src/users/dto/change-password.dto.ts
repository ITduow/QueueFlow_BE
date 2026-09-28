import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ example: 'OldPassword123' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({ example: 'NewPassword456' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/[a-z]/, { message: 'newPassword must contain a lowercase letter' })
  @Matches(/[A-Z]/, { message: 'newPassword must contain an uppercase letter' })
  @Matches(/[0-9]/, { message: 'newPassword must contain a number' })
  newPassword!: string;
}
