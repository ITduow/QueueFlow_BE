import { Module } from '@nestjs/common';
import { BusinessesModule } from '../businesses/businesses.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ServicesModule } from '../services/services.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { JobsModule } from '../jobs/jobs.module';
import { QueueTransitionService } from './queue-transition.service';
import { QueueWaitTimeService } from './queue-wait-time.service';
import { QueuesController } from './queues.controller';
import { QueuesService } from './queues.service';

@Module({
  imports: [PrismaModule, BusinessesModule, ServicesModule, RealtimeModule, JobsModule],
  controllers: [QueuesController],
  providers: [QueuesService, QueueTransitionService, QueueWaitTimeService],
})
export class QueuesModule {}
