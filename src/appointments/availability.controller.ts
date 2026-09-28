import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { AvailabilityQueryDto } from './dto/availability-query.dto';
import { AppointmentsService } from './appointments.service';

@ApiTags('Availability')
@Controller('businesses/:businessId/services/:serviceId/availability')
export class AvailabilityController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Public()
  @Get()
  get(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @Param('serviceId', new ParseUUIDPipe()) serviceId: string,
    @Query() query: AvailabilityQueryDto,
  ) {
    return this.appointmentsService.getAvailability(businessId, serviceId, query.date);
  }
}
