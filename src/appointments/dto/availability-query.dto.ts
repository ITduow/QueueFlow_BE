import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

export class AvailabilityQueryDto {
  @ApiProperty({ example: '2026-10-10', description: 'Local date in the business timezone.' })
  @IsDateString({ strict: true })
  date!: string;
}
