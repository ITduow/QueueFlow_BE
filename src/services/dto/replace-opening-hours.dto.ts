import { ApiProperty } from '@nestjs/swagger';
import { ValidateNested, ArrayMinSize, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { OpeningHourDto } from './opening-hour.dto';

export class ReplaceOpeningHoursDto {
  @ApiProperty({ type: [OpeningHourDto] })
  @ValidateNested({ each: true })
  @Type(() => OpeningHourDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  hours!: OpeningHourDto[];
}
