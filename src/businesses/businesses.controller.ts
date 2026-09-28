import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AddBusinessMemberDto } from './dto/add-business-member.dto';
import { CreateBusinessDto } from './dto/create-business.dto';
import { ListBusinessesQueryDto } from './dto/list-businesses-query.dto';
import { UpdateBusinessMemberDto } from './dto/update-business-member.dto';
import { UpdateBusinessDto } from './dto/update-business.dto';
import { BusinessesService } from './businesses.service';

@ApiTags('Businesses')
@Controller('businesses')
export class BusinessesController {
  constructor(private readonly businessesService: BusinessesService) {}

  @Post()
  @ApiBearerAuth()
  create(@CurrentUser('id') ownerId: string, @Body() dto: CreateBusinessDto) {
    return this.businessesService.create(ownerId, dto);
  }

  @Public()
  @Get()
  list(@Query() query: ListBusinessesQueryDto) {
    return this.businessesService.listPublic(query);
  }

  @Public()
  @Get(':slug')
  getBySlug(@Param('slug') slug: string) {
    return this.businessesService.getPublicBySlug(slug);
  }

  @Patch(':id')
  @ApiBearerAuth()
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: UpdateBusinessDto,
  ) {
    return this.businessesService.update(id, actor, dto);
  }

  @Delete(':id')
  @ApiBearerAuth()
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    await this.businessesService.suspend(id, actor);
    return { message: 'Business suspended successfully.' };
  }

  @Get(':id/members')
  @ApiBearerAuth()
  members(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.businessesService.listMembers(id, actor);
  }

  @Post(':id/members')
  @ApiBearerAuth()
  addMember(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: AddBusinessMemberDto,
  ) {
    return this.businessesService.addMember(id, actor, dto);
  }

  @Patch(':id/members/:memberId')
  @ApiBearerAuth()
  updateMember(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: UpdateBusinessMemberDto,
  ) {
    return this.businessesService.updateMember(id, memberId, actor, dto);
  }

  @Delete(':id/members/:memberId')
  @ApiBearerAuth()
  async removeMember(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    await this.businessesService.removeMember(id, memberId, actor);
    return { message: 'Business member removed successfully.' };
  }
}
