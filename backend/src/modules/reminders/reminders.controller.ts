import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

import { AuthenticatedUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/jwt-auth.guard';
import { CreateReminderDto } from './dto/reminder.dto';
import { RemindersService } from './reminders.service';

export class AcknowledgeDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  ids!: string[];
}

/**
 * Reminders always require an account, unlike browsing (section 33).
 * The global JwtAuthGuard enforces that: no @AllowGuest here.
 */
@ApiBearerAuth()
@ApiTags('reminders')
@Controller('reminders')
export class RemindersController {
  constructor(private readonly service: RemindersService) {}

  private require(user?: AuthenticatedUser): AuthenticatedUser {
    if (!user) throw new UnauthorizedException('this endpoint requires an account');
    return user;
  }

  @Post()
  @ApiOperation({ summary: 'Create or refresh a reminder for an exhibition' })
  create(@Body() body: CreateReminderDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.service.create(this.require(user), body);
  }

  @Get()
  @ApiOperation({ summary: 'Reminders belonging to the caller' })
  list(@CurrentUser() user?: AuthenticatedUser) {
    return this.service.list(this.require(user).id);
  }

  @Get('due')
  @ApiOperation({
    summary: 'Reminders whose moment has arrived and which have not been shown yet',
  })
  due(@CurrentUser() user?: AuthenticatedUser) {
    return this.service.due(this.require(user).id);
  }

  @Post('acknowledge')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark reminders as shown so they stop being due' })
  async acknowledge(@Body() body: AcknowledgeDto, @CurrentUser() user?: AuthenticatedUser) {
    const acknowledged = await this.service.acknowledge(this.require(user).id, body.ids);
    return { acknowledged };
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete one reminder' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.service.remove(this.require(user).id, id);
  }
}
