import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { BusinessStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateBusinessDto } from './create-business.dto';

export class UpdateBusinessDto extends PartialType(CreateBusinessDto) {
  @ApiPropertyOptional({ enum: BusinessStatus, description: 'Admin-only status change.' })
  @IsOptional()
  @IsEnum(BusinessStatus)
  status?: BusinessStatus;
}
