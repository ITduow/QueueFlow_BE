import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateQueueDto {
  @ApiPropertyOptional({ default: 'Main Queue', maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;
}
