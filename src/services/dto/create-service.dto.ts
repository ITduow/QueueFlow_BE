import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDecimal,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateServiceDto {
  @ApiProperty({ example: 'Haircut' })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name!: string;

  @ApiPropertyOptional({ example: 'Standard haircut' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 30 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes!: number;

  @ApiProperty({ example: '100000.00' })
  @IsString()
  @IsDecimal({ decimal_digits: '0,2' })
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'price must be a non-negative decimal with up to 2 decimals',
  })
  @MaxLength(13)
  price!: string;
}
