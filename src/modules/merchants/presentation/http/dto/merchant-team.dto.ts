import {
  ApiHideProperty,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import {
  TEAM_ACCEPT_CODE_HEX_LENGTH,
  TEAM_ASSIGNABLE_ROLES,
  TEAM_BRANCH_SCOPE_ALL,
  TEAM_INVITATION_STATUSES,
} from '../../../domain/merchant-team.types';

/**
 * Branch-scoped access does not exist. These keys are accepted by validation
 * only so the service can reject them with TEAM_INVALID_INPUT.
 */
class TeamBranchAssignmentGuardDto {
  @ApiHideProperty()
  @IsOptional()
  branchId?: unknown;

  @ApiHideProperty()
  @IsOptional()
  branchIds?: unknown;

  @ApiHideProperty()
  @IsOptional()
  branchScope?: unknown;
}

export class CreateTeamInvitationDto extends TeamBranchAssignmentGuardDto {
  @ApiProperty({
    description:
      'Invitee phone, normalized server-side with region DZ (E.164 accepted).',
    example: '+213550000001',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  phone!: string;

  @ApiProperty({ enum: TEAM_ASSIGNABLE_ROLES })
  @IsString()
  @MaxLength(64)
  role!: string;
}

export class UpdateTeamMemberDto extends TeamBranchAssignmentGuardDto {
  @ApiProperty({ enum: TEAM_ASSIGNABLE_ROLES })
  @IsString()
  @MaxLength(64)
  role!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class TeamExpectedVersionBodyDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class TeamExpectedVersionQueryDto {
  @ApiProperty({ minimum: 1, description: 'Current MerchantMember.version' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class AcceptTeamInvitationDto {
  @ApiProperty({
    description: 'One-time code shared manually by the OWNER.',
    minLength: TEAM_ACCEPT_CODE_HEX_LENGTH,
    maxLength: TEAM_ACCEPT_CODE_HEX_LENGTH,
  })
  @IsString()
  @Matches(/^[0-9a-f]+$/i)
  @MaxLength(TEAM_ACCEPT_CODE_HEX_LENGTH)
  acceptCode!: string;
}

export class TeamMemberResponseDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Account.phone; no display name exists.',
  })
  phone!: string | null;

  @ApiProperty({ enum: ['OWNER', 'MANAGER', 'STAFF'] })
  role!: string;

  @ApiProperty({ enum: [TEAM_BRANCH_SCOPE_ALL] })
  branchScope!: string;

  @ApiProperty()
  isSelf!: boolean;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  createdAt!: string;
}

export class TeamInvitationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  phone!: string;

  @ApiProperty({ enum: TEAM_ASSIGNABLE_ROLES })
  role!: string;

  @ApiProperty({ enum: TEAM_INVITATION_STATUSES })
  status!: string;

  @ApiProperty()
  expiresAt!: string;

  @ApiProperty({ enum: [TEAM_BRANCH_SCOPE_ALL] })
  branchScope!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  createdAt!: string;
}

export class TeamInvitationIssuedResponseDto extends TeamInvitationResponseDto {
  @ApiProperty({
    description:
      'Plaintext accept code, returned once. Only its SHA-256 is stored. No SMS/email is sent.',
  })
  acceptCode!: string;
}

export class TeamCapabilitiesResponseDto {
  @ApiProperty()
  canManage!: boolean;
}

export class MerchantTeamResponseDto {
  @ApiProperty()
  merchantId!: string;

  @ApiProperty({ type: [TeamMemberResponseDto] })
  members!: TeamMemberResponseDto[];

  @ApiProperty({ type: [TeamInvitationResponseDto] })
  invitations!: TeamInvitationResponseDto[];

  @ApiProperty({ type: TeamCapabilitiesResponseDto })
  capabilities!: TeamCapabilitiesResponseDto;
}

export class TeamMemberRevokedResponseDto {
  @ApiProperty()
  memberId!: string;

  @ApiProperty()
  revoked!: true;
}

export class MyTeamInvitationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  merchantId!: string;

  @ApiProperty()
  merchantName!: string;

  @ApiProperty({ enum: TEAM_ASSIGNABLE_ROLES })
  role!: string;

  @ApiProperty()
  expiresAt!: string;

  @ApiProperty({ enum: [TEAM_BRANCH_SCOPE_ALL] })
  branchScope!: string;

  @ApiProperty()
  createdAt!: string;
}

export class MyTeamInvitationsResponseDto {
  @ApiProperty({ type: [MyTeamInvitationResponseDto] })
  invitations!: MyTeamInvitationResponseDto[];
}

export class TeamInvitationAcceptedResponseDto {
  @ApiProperty()
  merchantId!: string;

  @ApiProperty()
  memberId!: string;

  @ApiProperty({ enum: TEAM_ASSIGNABLE_ROLES })
  role!: string;

  @ApiProperty({ enum: [TEAM_BRANCH_SCOPE_ALL] })
  branchScope!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  createdAt!: string;
}
