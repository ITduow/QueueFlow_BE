import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { BusinessMemberRole } from '../types/business-access.type';

export class UpdateBusinessMemberDto {
  @ApiPropertyOptional({ enum: [UserRole.STAFF, UserRole.MANAGER] })
  @IsOptional()
  @IsEnum(UserRole)
  role?: BusinessMemberRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
