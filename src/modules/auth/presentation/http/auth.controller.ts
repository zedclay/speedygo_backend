import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from '../../application/auth.service';
import { SessionService } from '../../application/session.service';
import { CurrentPrincipal } from './decorators/current-principal.decorator';
import { Public } from './decorators/public.decorator';
import { OtpRequestDto } from './dto/otp-request.dto';
import { OtpVerifyDto } from './dto/otp-verify.dto';
import { RefreshDto } from './dto/refresh.dto';
import { clientIp } from './request-ip';
import type { AuthenticatedPrincipal } from '../../domain/auth.types';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Post('otp/request')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Request an OTP (enumeration-resistant generic success)',
  })
  async requestOtp(@Body() body: OtpRequestDto, @Req() request: Request) {
    return this.auth.requestOtp({
      channel: body.channel,
      identifier: body.identifier,
      purpose: body.purpose,
      ip: clientIp(request),
    });
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify OTP and issue access + refresh tokens' })
  async verifyOtp(@Body() body: OtpVerifyDto, @Req() request: Request) {
    return this.auth.verifyOtp({
      channel: body.channel,
      identifier: body.identifier,
      purpose: body.purpose,
      code: body.code,
      device: {
        deviceId: body.deviceId,
        platform: body.platform,
        appVersion: body.appVersion,
        deviceName: body.deviceName,
      },
      ip: clientIp(request),
    });
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Rotate refresh token and issue a new access token',
  })
  async refresh(@Body() body: RefreshDto) {
    return this.auth.refresh(body.refreshToken);
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    await this.sessions.logout(principal.sessionId, principal.accountId);
    return { revoked: true };
  }

  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke every active session for the account' })
  async logoutAll(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    await this.sessions.logoutAll(principal.accountId);
    return { revoked: true };
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Current account identity and profile flags' })
  me(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.auth.me(principal.accountId);
  }

  @ApiBearerAuth()
  @Get('sessions')
  @ApiOperation({ summary: 'List sessions owned by the current account' })
  sessionsList(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.sessions.listOwned(principal.accountId, principal.sessionId);
  }

  @ApiBearerAuth()
  @Delete('sessions/:sessionId')
  @ApiOperation({ summary: 'Revoke one owned session' })
  async revokeSession(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
  ) {
    await this.sessions.revokeOwned(principal.accountId, sessionId);
    return { revoked: true };
  }
}
