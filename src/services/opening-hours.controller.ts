import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { OpeningHoursService } from './opening-hours.service';
import { ReplaceOpeningHoursDto } from './dto/replace-opening-hours.dto';

@ApiTags('Opening Hours')
@Controller('businesses/:businessId/opening-hours')
export class OpeningHoursController {
  constructor(private readonly openingHoursService: OpeningHoursService) {}

  @Public()
  @Get()
  get(@Param('businessId', new ParseUUIDPipe()) businessId: string) {
    return this.openingHoursService.getPublic(businessId);
  }

  @Put()
  @ApiBearerAuth()
  replace(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: ReplaceOpeningHoursDto,
  ) {
    return this.openingHoursService.replace(businessId, actor, dto);
  }
}
