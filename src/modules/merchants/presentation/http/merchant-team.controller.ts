import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { CurrentPrincipal } from '../../../auth/presentation/http/decorators/current-principal.decorator';
import { MerchantTeamService } from '../../application/merchant-team.service';
import { MERCHANT_ERROR_CODES } from '../../domain/merchant.errors';
import {
  AcceptTeamInvitationDto,
  CreateTeamInvitationDto,
  MerchantTeamResponseDto,
  MyTeamInvitationsResponseDto,
  TeamExpectedVersionBodyDto,
  TeamExpectedVersionQueryDto,
  TeamInvitationAcceptedResponseDto,
  TeamInvitationIssuedResponseDto,
  TeamInvitationResponseDto,
  TeamMemberResponseDto,
  TeamMemberRevokedResponseDto,
  UpdateTeamMemberDto,
} from './dto/merchant-team.dto';

@ApiTags('merchant-team')
@ApiBearerAuth()
@Controller('merchant')
export class MerchantTeamController {
  constructor(private readonly team: MerchantTeamService) {}

  @Get('me/team-invitations')
  @ApiOperation({
    summary: 'Pending team invitations addressed to the authenticated phone',
    description:
      'Phone-bound: only unexpired PENDING invitations whose phone equals the Account phone. Registered before :merchantId routes.',
  })
  @ApiOkResponse({ type: MyTeamInvitationsResponseDto })
  listMyInvitations(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.team.listMyInvitations(principal.accountId);
  }

  @Post('me/team-invitations/:invitationId/accept')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Accept a team invitation with the manually shared code',
    description:
      'Single-use. Creates the merchant-wide MerchantMember with the invited role. The Account phone must equal the invitation phone.',
  })
  @ApiOkResponse({ type: TeamInvitationAcceptedResponseDto })
  @ApiResponse({
    status: 400,
    description: MERCHANT_ERROR_CODES.TEAM_INVITE_CODE_INVALID,
  })
  @ApiResponse({
    status: 403,
    description: MERCHANT_ERROR_CODES.TEAM_PHONE_MISMATCH,
  })
  @ApiResponse({
    status: 404,
    description: MERCHANT_ERROR_CODES.TEAM_INVITE_NOT_FOUND,
  })
  @ApiResponse({
    status: 409,
    description: `${MERCHANT_ERROR_CODES.TEAM_INVITE_EXPIRED} | ${MERCHANT_ERROR_CODES.TEAM_DUPLICATE_MEMBER}`,
  })
  acceptInvitation(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('invitationId', new ParseUUIDPipe()) invitationId: string,
    @Body() body: AcceptTeamInvitationDto,
  ) {
    return this.team.acceptInvitation(
      principal.accountId,
      invitationId,
      body.acceptCode,
    );
  }

  @Get(':merchantId/team')
  @ApiOperation({
    summary: 'List team members and pending invitations',
    description:
      'TEAM_READ: OWNER and MANAGER. STAFF receives MERCHANT_ROLE_FORBIDDEN. Members expose Account phone, role, version; branchScope is always ALL_MERCHANT_BRANCHES.',
  })
  @ApiOkResponse({ type: MerchantTeamResponseDto })
  @ApiResponse({
    status: 403,
    description: MERCHANT_ERROR_CODES.MERCHANT_ROLE_FORBIDDEN,
  })
  @ApiResponse({
    status: 404,
    description: MERCHANT_ERROR_CODES.MERCHANT_NOT_FOUND,
  })
  getTeam(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
  ) {
    return this.team.getTeam(principal.accountId, merchantId);
  }

  @Post(':merchantId/team/invitations')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Create a team invitation (OWNER only)',
    description:
      'Returns the one-time acceptCode for manual sharing. No SMS or email is sent. Role must be MANAGER or STAFF; branch assignment keys are rejected.',
  })
  @ApiCreatedResponse({ type: TeamInvitationIssuedResponseDto })
  @ApiResponse({
    status: 409,
    description: `${MERCHANT_ERROR_CODES.TEAM_DUPLICATE_MEMBER} | ${MERCHANT_ERROR_CODES.TEAM_DUPLICATE_INVITE}`,
  })
  createInvitation(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Body() body: CreateTeamInvitationDto,
  ) {
    return this.team.createInvitation(principal.accountId, merchantId, body);
  }

  @Post(':merchantId/team/invitations/:invitationId/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a pending invitation (OWNER only)' })
  @ApiOkResponse({ type: TeamInvitationResponseDto })
  @ApiResponse({
    status: 409,
    description: MERCHANT_ERROR_CODES.TEAM_VERSION_CONFLICT,
  })
  cancelInvitation(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('invitationId', new ParseUUIDPipe()) invitationId: string,
    @Body() body: TeamExpectedVersionBodyDto,
  ) {
    return this.team.cancelInvitation(
      principal.accountId,
      merchantId,
      invitationId,
      body.expectedVersion,
    );
  }

  @Post(':merchantId/team/invitations/:invitationId/regenerate-code')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Regenerate the accept code of a pending invitation (OWNER only)',
    description:
      'New code hash, fresh expiry, version + 1. The previous code stops working. No delivery.',
  })
  @ApiOkResponse({ type: TeamInvitationIssuedResponseDto })
  @ApiResponse({
    status: 409,
    description: MERCHANT_ERROR_CODES.TEAM_VERSION_CONFLICT,
  })
  regenerateCode(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('invitationId', new ParseUUIDPipe()) invitationId: string,
    @Body() body: TeamExpectedVersionBodyDto,
  ) {
    return this.team.regenerateInvitationCode(
      principal.accountId,
      merchantId,
      invitationId,
      body.expectedVersion,
    );
  }

  @Patch(':merchantId/team/members/:memberId')
  @ApiOperation({
    summary: 'Change a member role MANAGER <-> STAFF (OWNER only)',
    description:
      'OWNER targets, self targets and OWNER role assignment are rejected. A demotion revokes every Session of the target Account.',
  })
  @ApiOkResponse({ type: TeamMemberResponseDto })
  @ApiResponse({
    status: 403,
    description: `${MERCHANT_ERROR_CODES.TEAM_OWNER_PROTECTED} | ${MERCHANT_ERROR_CODES.TEAM_SELF_FORBIDDEN}`,
  })
  @ApiResponse({
    status: 409,
    description: MERCHANT_ERROR_CODES.TEAM_VERSION_CONFLICT,
  })
  updateMember(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
    @Body() body: UpdateTeamMemberDto,
  ) {
    return this.team.updateMemberRole(
      principal.accountId,
      merchantId,
      memberId,
      body,
    );
  }

  @Delete(':merchantId/team/members/:memberId')
  @ApiOperation({
    summary: 'Revoke a MANAGER/STAFF membership (OWNER only)',
    description:
      'Deletes this Merchant MerchantMember row only and revokes every Session of the target Account. expectedVersion is a query parameter.',
  })
  @ApiOkResponse({ type: TeamMemberRevokedResponseDto })
  @ApiResponse({
    status: 403,
    description: `${MERCHANT_ERROR_CODES.TEAM_OWNER_PROTECTED} | ${MERCHANT_ERROR_CODES.TEAM_SELF_FORBIDDEN}`,
  })
  @ApiResponse({
    status: 409,
    description: MERCHANT_ERROR_CODES.TEAM_VERSION_CONFLICT,
  })
  revokeMember(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
    @Query() query: TeamExpectedVersionQueryDto,
  ) {
    return this.team.revokeMember(
      principal.accountId,
      merchantId,
      memberId,
      query.expectedVersion,
    );
  }
}
