import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
} from '../../../domain/support.policy';

/** User create — body + optional orderId only. Spoof fields rejected by forbidNonWhitelisted. */
export class CreateSupportTicketDto {
  @ApiProperty({ minLength: 1, maxLength: 4000 })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  orderId?: string;
}

export class SupportMessageBodyDto {
  @ApiProperty({ minLength: 1, maxLength: 4000 })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;
}

export class SupportListQueryDto {
  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  offset?: number;
}

export class AdminSupportListQueryDto extends SupportListQueryDto {
  @ApiPropertyOptional({ enum: SUPPORT_STATUSES })
  @IsOptional()
  @IsIn([...SUPPORT_STATUSES])
  status?: string;

  @ApiPropertyOptional({ enum: SUPPORT_PRIORITIES })
  @IsOptional()
  @IsIn([...SUPPORT_PRIORITIES])
  priority?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  assignedAdminId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  createdFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  createdTo?: string;
}

export class AdminSupportAssignDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'AdminProfile id or null to unassign',
  })
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  assignedAdminId!: string | null;
}

export class AdminSupportPriorityDto {
  @ApiProperty({ enum: SUPPORT_PRIORITIES })
  @IsIn([...SUPPORT_PRIORITIES])
  priority!: string;
}
