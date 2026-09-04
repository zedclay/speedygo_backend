import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { CurrentPrincipal } from '../../../auth/presentation/http/decorators/current-principal.decorator';
import { NotificationService } from '../../application/notification.service';
import { NOTIFICATION_ERROR_CODES } from '../../domain/notification.errors';
import {
  DeactivateDeviceTokenDto,
  DeviceTokenResponseDto,
  ListNotificationsQueryDto,
  MarkAllReadResponseDto,
  NotificationItemResponseDto,
  NotificationListResponseDto,
  RegisterDeviceTokenDto,
  UnreadCountResponseDto,
} from './dto/notification.dto';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  @ApiOperation({
    summary: 'List in-app notifications for the authenticated Account',
    description:
      'Account-scoped inbox. Newest first. Paginated. No cross-Account access. System-generated only — no public create.',
  })
  @ApiOkResponse({ type: NotificationListResponseDto })
  list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notifications.listForAccount(principal.accountId, {
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread notification count for the Account' })
  @ApiOkResponse({ type: UnreadCountResponseDto })
  unreadCount(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.notifications.unreadCount(principal.accountId);
  }

  @Post(':notificationId/read')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mark one own notification as read',
    description:
      'Idempotent. Foreign notificationId returns NOTIFICATION_NOT_FOUND.',
  })
  @ApiOkResponse({ type: NotificationItemResponseDto })
  @ApiResponse({
    status: 404,
    description: NOTIFICATION_ERROR_CODES.NOTIFICATION_NOT_FOUND,
  })
  markRead(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('notificationId', ParseUUIDPipe) notificationId: string,
  ) {
    return this.notifications.markRead(principal.accountId, notificationId);
  }

  @Post('read-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark all Account notifications as read' })
  @ApiOkResponse({ type: MarkAllReadResponseDto })
  markAllRead(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.notifications.markAllRead(principal.accountId);
  }

  @Put('device-tokens')
  @ApiOperation({
    summary: 'Register or rotate own Device push token',
    description:
      'Self-registration only. Does not enable production Push delivery until a provider is configured. Logout does not auto-deactivate tokens.',
  })
  @ApiOkResponse({ type: DeviceTokenResponseDto })
  async registerToken(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: RegisterDeviceTokenDto,
  ) {
    const row = await this.notifications.registerDeviceToken({
      accountId: principal.accountId,
      token: body.token,
      platform: body.platform,
      deviceId: body.deviceId,
    });
    return {
      id: row.id,
      platform: row.platform,
      active: row.active,
      deviceId: row.deviceId,
    };
  }

  @Delete('device-tokens')
  @HttpCode(200)
  @ApiOperation({ summary: 'Deactivate own Device push token' })
  @ApiOkResponse({
    schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
  })
  async deactivateToken(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: DeactivateDeviceTokenDto,
  ) {
    await this.notifications.deactivateDeviceToken(
      principal.accountId,
      body.token,
    );
    return { ok: true };
  }
}
