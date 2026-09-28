import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class JoinQueueDto {
  @ApiProperty()
  @IsUUID()
  serviceId!: string;
}
