import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  AUTH_CHANNELS,
  DEVICE_PLATFORMS,
  OTP_PURPOSES,
} from '../../../domain/auth.types';

export class OtpVerifyDto {
  @ApiProperty({ enum: AUTH_CHANNELS })
  @IsIn(AUTH_CHANNELS)
  channel!: 'PHONE' | 'EMAIL';

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  identifier!: string;

  @ApiProperty({ enum: OTP_PURPOSES })
  @IsIn(OTP_PURPOSES)
  purpose!: 'AUTHENTICATE';

  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6)
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @ApiProperty({ enum: DEVICE_PLATFORMS })
  @IsIn(DEVICE_PLATFORMS)
  platform!: 'ios' | 'android' | 'web';

  @ApiProperty({ example: '1.0.0' })
  @IsString()
  @MaxLength(32)
  appVersion!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceName?: string;
}
