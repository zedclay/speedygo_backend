import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { moneyMinorToDecimalString } from '../../../../../common/money/money-minor';
import { RequirePermissions } from '../../../../authorization/require-permissions.decorator';
import { ADMIN_PERMISSIONS } from '../../../../admin/domain/admin-permissions';
import type { CurrentAdminContext } from '../../../../admin/domain/admin.types';
import { AdminGuard } from '../../../../admin/presentation/guards/admin.guard';
import { CurrentAdmin } from '../../../../admin/presentation/decorators/current-admin.decorator';
import { AdminEmptyBodyDto } from '../../../../admin/presentation/http/dto/admin.dto';
import { AdminDeliveryPricingRuleCommandsService } from '../../../application/admin-delivery-pricing-rule-commands.service';
import { DeliveryPricingRuleRepository } from '../../../infrastructure/delivery-pricing-rule.repository';
import { normalizeListQuery } from '../../../../admin/domain/admin.policy';
import {
  AdminDeliveryPricingRuleListQueryDto,
  CreateAdminDeliveryPricingRuleDto,
} from '../dto/admin-delivery.dto';
import type {
  DeliveryPricingRuleRecord,
  DeliveryTimeBand,
} from '../../../domain/delivery-pricing.types';

function serializeRule(
  rule: DeliveryPricingRuleRecord,
): Record<string, unknown> {
  return {
    id: rule.id,
    zoneId: rule.zoneId,
    name: rule.name,
    timeBand: rule.timeBand,
    startLocalTime: rule.startLocalTime,
    endLocalTime: rule.endLocalTime,
    customerDeliveryFeeMinor: moneyMinorToDecimalString(
      rule.customerDeliveryFeeMinor,
    ),
    driverRemunerationMinor: moneyMinorToDecimalString(
      rule.driverRemunerationMinor,
    ),
    effectiveFrom: rule.effectiveFrom,
    effectiveTo: rule.effectiveTo,
    active: rule.active,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

@ApiTags('admin-delivery-pricing-rules')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/delivery/pricing-rules')
export class AdminDeliveryPricingRuleController {
  constructor(
    private readonly ruleRepo: DeliveryPricingRuleRepository,
    private readonly commands: AdminDeliveryPricingRuleCommandsService,
  ) {}

  @Get()
  @RequirePermissions(ADMIN_PERMISSIONS.DELIVERY_PRICING_READ)
  @ApiOperation({ summary: 'List delivery pricing rules' })
  async list(@Query() query: AdminDeliveryPricingRuleListQueryDto) {
    const { limit, offset } = normalizeListQuery(query);
    const result = await this.ruleRepo.list({
      limit,
      offset,
      zoneId: query.zoneId,
      active: query.active,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });
    return {
      items: result.items.map(serializeRule),
      total: result.total,
      limit,
      offset,
    };
  }

  @Get(':id')
  @RequirePermissions(ADMIN_PERMISSIONS.DELIVERY_PRICING_READ)
  @ApiOperation({ summary: 'Get delivery pricing rule by id' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const rule = await this.ruleRepo.requireById(id);
    return serializeRule(rule);
  }

  @Post()
  @RequirePermissions(ADMIN_PERMISSIONS.DELIVERY_PRICING_MANAGE)
  @ApiOperation({ summary: 'Create delivery pricing rule (starts inactive)' })
  async create(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Body() body: CreateAdminDeliveryPricingRuleDto,
  ) {
    const rule = await this.commands.create(admin, {
      zoneId: body.zoneId,
      name: body.name,
      timeBand: body.timeBand as DeliveryTimeBand,
      startLocalTime: body.startLocalTime ?? null,
      endLocalTime: body.endLocalTime ?? null,
      customerDeliveryFeeMinor: BigInt(body.customerDeliveryFeeMinor),
      driverRemunerationMinor: BigInt(body.driverRemunerationMinor),
      effectiveFrom: body.effectiveFrom,
      effectiveTo: body.effectiveTo ?? null,
    });
    return serializeRule(rule);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermissions(ADMIN_PERMISSIONS.DELIVERY_PRICING_MANAGE)
  @ApiOperation({
    summary: 'Activate delivery pricing rule (at most 1 active per zone)',
  })
  async activate(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _body: AdminEmptyBodyDto,
  ) {
    const rule = await this.commands.activate(admin, id);
    return serializeRule(rule);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermissions(ADMIN_PERMISSIONS.DELIVERY_PRICING_MANAGE)
  @ApiOperation({ summary: 'Deactivate delivery pricing rule' })
  async deactivate(
    @CurrentAdmin() admin: CurrentAdminContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _body: AdminEmptyBodyDto,
  ) {
    const rule = await this.commands.deactivate(admin, id);
    return serializeRule(rule);
  }
}
