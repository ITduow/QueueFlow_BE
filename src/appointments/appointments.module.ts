import { Module } from '@nestjs/common';
import { BusinessesModule } from '../businesses/businesses.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ServicesModule } from '../services/services.module';
import { JobsModule } from '../jobs/jobs.module';
import { AppointmentTransitionService } from './appointment-transition.service';
import { AvailabilityController } from './availability.controller';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

@Module({
  imports: [PrismaModule, BusinessesModule, ServicesModule, JobsModule],
  controllers: [AppointmentsController, AvailabilityController],
  providers: [AppointmentsService, AppointmentTransitionService],
})
export class AppointmentsModule {}
