import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Andy Nguyen' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  fullName?: string;

  @ApiPropertyOptional({ example: '0901234567', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Matches(/^[+()\-\s.\d]+$/, { message: 'phone contains invalid characters' })
  phone?: string | null;

  @ApiPropertyOptional({ example: 'https://example.com/avatar.png', nullable: true })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  avatarUrl?: string | null;
}
