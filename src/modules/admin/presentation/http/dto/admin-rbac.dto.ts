import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
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
  ADMIN_LIST_DEFAULT_LIMIT,
  ADMIN_LIST_MAX_LIMIT,
  ADMIN_LIST_MAX_OFFSET,
} from '../../../domain/admin.types';
import { ADMIN_ACCOUNT_STATUSES } from '../../../domain/admin-rbac.types';

export class AdminAdminsListQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: ADMIN_LIST_MAX_LIMIT,
    default: ADMIN_LIST_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ADMIN_LIST_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: ADMIN_LIST_MAX_OFFSET,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(ADMIN_LIST_MAX_OFFSET)
  offset?: number;

  @ApiPropertyOptional({ description: 'Search displayName / phone / email / role' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional({ enum: ADMIN_ACCOUNT_STATUSES })
  @IsOptional()
  @IsIn([...ADMIN_ACCOUNT_STATUSES])
  accountStatus?: string;
}

export class CreateAdminProfileDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  displayName!: string;

  @ApiProperty()
  @IsUUID()
  roleId!: string;

  @ApiPropertyOptional({
    description: 'E.164 or local DZ phone — required if email omitted (OTP login).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional({
    description: 'Required if phone omitted (OTP login).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({
    enum: ADMIN_ACCOUNT_STATUSES,
    default: 'ACTIVE',
    description: 'Account.status — AdminProfile has no status column.',
  })
  @IsOptional()
  @IsIn([...ADMIN_ACCOUNT_STATUSES])
  accountStatus?: string;
}

export class UpdateAdminProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  displayName?: string;

  @ApiPropertyOptional({
    description: 'Forbidden for self. Target Role must be active.',
  })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional({
    enum: ADMIN_ACCOUNT_STATUSES,
    description: 'Forbidden for self. Maps to Account.status.',
  })
  @IsOptional()
  @IsIn([...ADMIN_ACCOUNT_STATUSES])
  accountStatus?: string;
}

export class AdminRolesListQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: ADMIN_LIST_MAX_LIMIT,
    default: ADMIN_LIST_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ADMIN_LIST_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: ADMIN_LIST_MAX_OFFSET,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(ADMIN_LIST_MAX_OFFSET)
  offset?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  active?: boolean;
}

export class CreateAdminRoleDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(128)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiProperty({
    type: [String],
    description: 'Must be ⊆ actor permissions; codes must exist in catalogue.',
  })
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  permissionCodes!: string[];
}

export class UpdateAdminRoleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(128)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    type: [String],
    description: 'Full replacement set when provided.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  permissionCodes?: string[];
}
