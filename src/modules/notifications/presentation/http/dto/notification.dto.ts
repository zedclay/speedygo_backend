import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  NOTIFICATION_LIST_DEFAULT_LIMIT,
  NOTIFICATION_LIST_MAX_LIMIT,
  NOTIFICATION_LIST_MAX_OFFSET,
} from '../../../domain/notification.types';

export class ListNotificationsQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: NOTIFICATION_LIST_MAX_LIMIT,
    default: NOTIFICATION_LIST_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NOTIFICATION_LIST_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: NOTIFICATION_LIST_MAX_OFFSET,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(NOTIFICATION_LIST_MAX_OFFSET)
  offset?: number;
}

export class RegisterDeviceTokenDto {
  @ApiProperty({
    description:
      'Push provider token for the authenticated Account. Never accepted for another Account.',
    minLength: 8,
    maxLength: 4096,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(4096)
  token!: string;

  @ApiProperty({ enum: ['ios', 'android', 'web'] })
  @IsString()
  platform!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optional Device id owned via Auth Device upsert.',
  })
  @IsOptional()
  @IsUUID()
  deviceId?: string;
}

export class DeactivateDeviceTokenDto {
  @ApiProperty({ minLength: 8, maxLength: 4096 })
  @IsString()
  @MinLength(8)
  @MaxLength(4096)
  token!: string;
}

export class NotificationItemResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty({
    description: 'Authoritative source entity id (Order, Payment, etc.)',
  })
  sourceId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty()
  read!: boolean;

  @ApiProperty()
  createdAt!: string;
}

export class NotificationListResponseDto {
  @ApiProperty({ type: [NotificationItemResponseDto] })
  items!: NotificationItemResponseDto[];

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  offset!: number;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  unreadCount!: number;
}

export class UnreadCountResponseDto {
  @ApiProperty()
  unreadCount!: number;
}

export class MarkAllReadResponseDto {
  @ApiProperty()
  marked!: number;
}

export class DeviceTokenResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  platform!: string;

  @ApiProperty()
  active!: boolean;

  @ApiProperty({ nullable: true, type: String })
  deviceId!: string | null;
}
