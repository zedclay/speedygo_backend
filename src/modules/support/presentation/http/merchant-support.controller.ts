import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '../../../auth/domain/auth.types';
import { CurrentPrincipal } from '../../../auth/presentation/http/decorators/current-principal.decorator';
import { SupportService } from '../../application/support.service';
import {
  CreateSupportTicketDto,
  SupportListQueryDto,
  SupportMessageBodyDto,
} from './dto/support.dto';

@ApiTags('merchant-support')
@ApiBearerAuth()
@Controller('merchant/:merchantId/support')
export class MerchantSupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @ApiOperation({
    summary: 'Create Merchant Support ticket',
    description:
      'OWNER or MANAGER only (STAFF forbidden). merchantId from path. Optional orderId must belong to this Merchant via MerchantBranch.',
  })
  create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Body() body: CreateSupportTicketDto,
  ) {
    return this.support.createMerchantTicket(
      principal.accountId,
      merchantId,
      body.body,
      body.orderId,
    );
  }

  @Get()
  @ApiOperation({ summary: 'List Merchant Support tickets' })
  list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Query() query: SupportListQueryDto,
  ) {
    return this.support.listMerchantTickets(
      principal.accountId,
      merchantId,
      query,
    );
  }

  @Get(':ticketId')
  @ApiOperation({
    summary: 'Get Merchant Support ticket',
    description: 'Never includes internal notes.',
  })
  get(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Query() query: SupportListQueryDto,
  ) {
    return this.support.getMerchantTicket(
      principal.accountId,
      merchantId,
      ticketId,
      query,
    );
  }

  @Post(':ticketId/messages')
  @ApiOperation({ summary: 'Reply on Merchant Support ticket' })
  reply(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() body: SupportMessageBodyDto,
  ) {
    return this.support.replyMerchantTicket(
      principal.accountId,
      merchantId,
      ticketId,
      body.body,
    );
  }
}
