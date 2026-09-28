import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { ServicesService } from './services.service';

@ApiTags('Services')
@Controller()
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Post('businesses/:businessId/services')
  @ApiBearerAuth()
  create(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateServiceDto,
  ) {
    return this.servicesService.create(businessId, actor, dto);
  }

  @Public()
  @Get('businesses/:businessId/services')
  list(@Param('businessId', new ParseUUIDPipe()) businessId: string) {
    return this.servicesService.listPublic(businessId);
  }

  @Public()
  @Get('services/:id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.servicesService.getPublicById(id);
  }

  @Patch('services/:id')
  @ApiBearerAuth()
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.servicesService.update(id, actor, dto);
  }

  @Delete('services/:id')
  @ApiBearerAuth()
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    await this.servicesService.deactivate(id, actor);
    return { message: 'Service deactivated successfully.' };
  }
}
