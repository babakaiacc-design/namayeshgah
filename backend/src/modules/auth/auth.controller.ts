import { Body, Controller, Get, Post, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

import { AuthService, AuthenticatedUser } from './auth.service';
import { AllowGuest, CurrentUser } from './jwt-auth.guard';

export class DeviceAuthDto {
  /**
   * A client-generated identifier, stable for the install. The server stores
   * only a keyed hash of it.
   */
  @ApiProperty({ example: '6f1c2a1e-9b3d-4c7a-8f2e-1d0b5a7c3e94' })
  @IsString()
  @Length(8, 128)
  deviceId!: string;

  @ApiPropertyOptional({ example: 'fa' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z]{2}(-[A-Z]{2})?$/, { message: 'locale must look like fa or fa-IR' })
  locale?: string;

  @ApiPropertyOptional({ example: 'Asia/Tehran' })
  @IsOptional()
  @IsString()
  @Length(3, 64)
  timezone?: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Post('device')
  @AllowGuest()
  @ApiOperation({
    summary: 'Sign in an anonymous device, creating the account on first contact',
  })
  device(@Body() body: DeviceAuthDto) {
    return this.service.authenticateDevice(body);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The account behind the supplied token' })
  async me(@CurrentUser() user?: AuthenticatedUser) {
    if (!user) throw new UnauthorizedException('this endpoint requires an account');
    await this.service.touch(user.id);
    return user;
  }
}
