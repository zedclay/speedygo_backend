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

@ApiTags('driver-support')
@ApiBearerAuth()
@Controller('driver/support')
export class DriverSupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @ApiOperation({
    summary: 'Create Support ticket',
    description:
      'Requires DriverProfile. driverId forced to own profile. Optional orderId must have Delivery+DriverAssignment for this Driver. Suspended Drivers may still access own tickets.',
  })
  create(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: CreateSupportTicketDto,
  ) {
    return this.support.createDriverTicket(
      principal.accountId,
      body.body,
      body.orderId,
    );
  }

  @Get()
  @ApiOperation({ summary: 'List Driver-accessible Support tickets' })
  list(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() query: SupportListQueryDto,
  ) {
    return this.support.listDriverTickets(principal.accountId, query);
  }

  @Get(':ticketId')
  @ApiOperation({
    summary: 'Get Driver-accessible Support ticket',
    description: 'Never includes internal notes.',
  })
  get(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Query() query: SupportListQueryDto,
  ) {
    return this.support.getDriverTicket(principal.accountId, ticketId, query);
  }

  @Post(':ticketId/messages')
  @ApiOperation({
    summary: 'Reply on Driver-accessible Support ticket',
  })
  reply(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() body: SupportMessageBodyDto,
  ) {
    return this.support.replyDriverTicket(
      principal.accountId,
      ticketId,
      body.body,
    );
  }
}
