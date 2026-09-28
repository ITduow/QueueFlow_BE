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
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CreateQueueDto } from './dto/create-queue.dto';
import { JoinQueueDto } from './dto/join-queue.dto';
import { ListQueueEntriesQueryDto } from './dto/list-queue-entries-query.dto';
import { QueuesService } from './queues.service';

@ApiTags('Queues')
@Controller()
export class QueuesController {
  constructor(private readonly queues: QueuesService) {}

  @Post('businesses/:businessId/queues')
  @ApiBearerAuth()
  create(
    @Param('businessId', new ParseUUIDPipe()) businessId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateQueueDto,
  ) {
    return this.queues.create(businessId, actor, dto);
  }

  @Public()
  @Get('businesses/:businessId/queues/current')
  current(@Param('businessId', new ParseUUIDPipe()) businessId: string) {
    return this.queues.currentPublic(businessId);
  }

  @Post('queues/:queueId/join')
  @ApiBearerAuth()
  join(
    @Param('queueId', new ParseUUIDPipe()) queueId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: JoinQueueDto,
  ) {
    return this.queues.join(queueId, actor, dto);
  }

  @Delete('queues/:queueId/leave')
  @ApiBearerAuth()
  leave(
    @Param('queueId', new ParseUUIDPipe()) queueId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.queues.leave(queueId, actor);
  }

  @Get('queues/:queueId/status')
  @ApiBearerAuth()
  status(
    @Param('queueId', new ParseUUIDPipe()) queueId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.queues.status(queueId, actor);
  }

  @Get('queues/:queueId/entries')
  @ApiBearerAuth()
  entries(
    @Param('queueId', new ParseUUIDPipe()) queueId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListQueueEntriesQueryDto,
  ) {
    return this.queues.entries(queueId, actor, query);
  }

  @Post('queues/:queueId/next')
  @ApiBearerAuth()
  next(
    @Param('queueId', new ParseUUIDPipe()) queueId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.queues.next(queueId, actor);
  }

  @Patch('queue-entries/:entryId/call')
  @ApiBearerAuth()
  call(
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.queues.call(entryId, actor);
  }

  @Patch('queue-entries/:entryId/serve')
  @ApiBearerAuth()
  serve(
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.queues.serve(entryId, actor);
  }

  @Patch('queue-entries/:entryId/complete')
  @ApiBearerAuth()
  complete(
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.queues.complete(entryId, actor);
  }

  @Patch('queue-entries/:entryId/skip')
  @ApiBearerAuth()
  skip(
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.queues.skip(entryId, actor);
  }
}
