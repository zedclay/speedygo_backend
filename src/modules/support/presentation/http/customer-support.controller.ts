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

@ApiTags('customer-support')
@ApiBearerAuth()
@Controller('customer/support')
export class CustomerSupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @ApiOperation({
    summary: 'Create Support ticket',
    description:
      'Requires CustomerProfile. Creates OPEN/NORMAL ticket + first message atomically. Optional orderId must belong to this Customer. Ignores client priority/status/merchantId/driverId.',
  })
  create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: CreateSupportTicketDto,
  ) {
    return this.support.createCustomerTicket(
      principal.accountId,
      body.body,
      body.orderId,
    );
  }

  @Get()
  @ApiOperation({ summary: 'List own Support tickets' })
  list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() query: SupportListQueryDto,
  ) {
    return this.support.listCustomerTickets(principal.accountId, query);
  }

  @Get(':ticketId')
  @ApiOperation({
    summary: 'Get own Support ticket',
    description: 'Messages oldest-first. Never includes internal notes.',
  })
  get(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Query() query: SupportListQueryDto,
  ) {
    return this.support.getCustomerTicket(principal.accountId, ticketId, query);
  }

  @Post(':ticketId/messages')
  @ApiOperation({
    summary: 'Reply on own Support ticket',
    description:
      'Allowed when OPEN|IN_PROGRESS|WAITING_CUSTOMER. WAITING_CUSTOMER → IN_PROGRESS. RESOLVED|CLOSED → conflict (no auto-reopen).',
  })
  reply(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() body: SupportMessageBodyDto,
  ) {
    return this.support.replyCustomerTicket(
      principal.accountId,
      ticketId,
      body.body,
    );
  }
}
