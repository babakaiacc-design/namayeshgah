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
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

import { AuthenticatedUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/jwt-auth.guard';
import { FavoritesService } from './favorites.service';

export class CreateFavoriteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  exhibitionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

@ApiBearerAuth()
@ApiTags('favorites')
@Controller('favorites')
export class FavoritesController {
  constructor(private readonly service: FavoritesService) {}

  private require(user?: AuthenticatedUser): AuthenticatedUser {
    if (!user) throw new UnauthorizedException('this endpoint requires an account');
    return user;
  }

  @Post()
  @ApiOperation({ summary: 'Follow an exhibition or a category' })
  add(@Body() body: CreateFavoriteDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.service.add(this.require(user).id, body);
  }

  @Get()
  @ApiOperation({ summary: 'Everything the caller follows' })
  list(@CurrentUser() user?: AuthenticatedUser) {
    return this.service.list(this.require(user).id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Stop following' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.service.remove(this.require(user).id, id);
  }
}
