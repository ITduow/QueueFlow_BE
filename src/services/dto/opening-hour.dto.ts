import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

export class OpeningHourDto {
  @ApiProperty({ example: 1, description: '0 = Sunday, 6 = Saturday' })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @ApiPropertyOptional({ example: '09:00', nullable: true })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  openTime?: string | null;

  @ApiPropertyOptional({ example: '18:00', nullable: true })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  closeTime?: string | null;

  @ApiProperty({ example: false })
  @IsBoolean()
  isClosed!: boolean;
}
