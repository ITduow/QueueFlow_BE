import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { ListBusinessAppointmentsQueryDto } from './dto/list-business-appointments-query.dto';
import { ListMyAppointmentsQueryDto } from './dto/list-my-appointments-query.dto';
import { AppointmentsService } from './appointments.service';

@ApiTags('Appointments')
@Controller()
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Post('appointments')
  @ApiBearerAuth()
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateAppointmentDto) {
    return this.appointmentsService.create(actor, dto);
  }

  @Get('appointments/me')
  @ApiBearerAuth()
  listMine(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListMyAppointmentsQueryDto) {
    return this.appointmentsService.listMine(actor, query);
  }

  @Get('appointments/:id')
  @ApiBearerAuth()
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.appointmentsService.getById(id, actor);
  }

  @Patch('appointments/:id/cancel')
  @ApiBearerAuth()
  cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CancelAppointmentDto,
  ) {
    return this.appointmentsService.cancel(id, actor, dto);
  }

  @Patch('appointments/:id/confirm')
  @ApiBearerAuth()
  confirm(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.appointmentsService.confirm(id, actor);
  }

  @Patch('appointments/:id/complete')
  @ApiBearerAuth()
  complete(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.appointmentsService.complete(id, actor);
  }

  @Patch('appointments/:id/no-show')
  @ApiBearerAuth()
  noShow(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.appointmentsService.noShow(id, actor);
  }

  @Get('businesses/:businessId/appointments')
  @ApiBearerAuth()
  listBusiness(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListBusinessAppointmentsQueryDto,
  ) {
    return this.appointmentsService.listBusiness(businessId, actor, query);
  }
}
