import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { AUTH_CHANNELS, OTP_PURPOSES } from '../../../domain/auth.types';

export class OtpRequestDto {
  @ApiProperty({ enum: AUTH_CHANNELS })
  @IsIn(AUTH_CHANNELS)
  channel!: 'PHONE' | 'EMAIL';

  @ApiProperty({ example: '0550123456' })
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  identifier!: string;

  @ApiProperty({ enum: OTP_PURPOSES, default: 'AUTHENTICATE' })
  @IsIn(OTP_PURPOSES)
  purpose!: 'AUTHENTICATE';
}
