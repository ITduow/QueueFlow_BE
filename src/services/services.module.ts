import { Module } from '@nestjs/common';
import { BusinessesModule } from '../businesses/businesses.module';
import { AvailabilityService } from './availability.service';
import { OpeningHoursController } from './opening-hours.controller';
import { OpeningHoursService } from './opening-hours.service';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [BusinessesModule, RedisModule],
  controllers: [ServicesController, OpeningHoursController],
  providers: [ServicesService, OpeningHoursService, AvailabilityService],
  exports: [ServicesService, OpeningHoursService, AvailabilityService],
})
export class ServicesModule {}
