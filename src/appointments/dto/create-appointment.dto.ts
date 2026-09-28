import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID, MaxLength, IsString } from 'class-validator';

export class CreateAppointmentDto {
  @ApiProperty()
  @IsUUID()
  businessId!: string;

  @ApiProperty()
  @IsUUID()
  serviceId!: string;

  @ApiProperty({ example: '2026-10-10T07:00:00.000Z' })
  @IsDateString()
  startTime!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  customerNote?: string;
}
