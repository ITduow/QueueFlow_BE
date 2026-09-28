import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsEnum, IsUUID } from 'class-validator';
import { BusinessMemberRole } from '../types/business-access.type';

export class AddBusinessMemberDto {
  @ApiProperty()
  @IsUUID()
  userId!: string;

  @ApiProperty({ enum: [UserRole.STAFF, UserRole.MANAGER] })
  @IsEnum(UserRole)
  role!: BusinessMemberRole;
}
