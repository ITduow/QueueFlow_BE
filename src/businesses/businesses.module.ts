import { Module } from '@nestjs/common';
import { BusinessesController } from './businesses.controller';
import { BusinessesService } from './businesses.service';
import { RedisModule } from '../redis/redis.module';

@Module({
  controllers: [BusinessesController],
  imports: [RedisModule],
  providers: [BusinessesService],
  exports: [BusinessesService],
})
export class BusinessesModule {}
