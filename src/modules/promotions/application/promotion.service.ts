import { Injectable } from '@nestjs/common';
import {
  promotionConfigurationInvalid,
  promotionNotFound,
  promotionStackingUnsupported,
} from '../domain/promotion.errors';
import {
  buildPromotionDecision,
  normalizePromotionCode,
  parsePromotionType,
  requireCreatePromotionWindow,
  requirePromotionValue,
} from '../domain/promotion.policy';
import type {
  CreatePromotionInput,
  EvaluatePromotionInput,
  PromotionDecision,
  PromotionRecord,
  PromotionRedemptionRecord,
} from '../domain/promotion.types';
import {
  PromotionRepository,
  type OrmClient,
} from '../infrastructure/promotion.repository';

@Injectable()
export class PromotionService {
  constructor(private readonly promotions: PromotionRepository) {}

  /**
   * Internal trusted configuration for tests / future Admin.
   * No public HTTP mutation.
   */
  async createPromotion(input: CreatePromotionInput): Promise<PromotionRecord> {
    const code = normalizePromotionCode(input.code);
    const parsed = parsePromotionType(input.type);
    requirePromotionValue(parsed.kind, input.value);
    requireCreatePromotionWindow(input.startsAt, input.endsAt);
    const existing = await this.promotions.findByNormalizedCode(code);
    if (existing) {
      throw promotionConfigurationInvalid('Promotion code already exists');
    }
    return this.promotions.createPromotion({
      code,
      type: parsed.type,
      value: input.value,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      active: input.active ?? true,
    });
  }

  async setPromotionActive(
    promotionId: string,
    active: boolean,
  ): Promise<PromotionRecord> {
    const existing = await this.promotions.findById(promotionId);
    if (!existing) {
      throw promotionNotFound();
    }
    return this.promotions.setActive(promotionId, active);
  }

  /**
   * Stateless evaluation for Checkout preview. Does NOT create a redemption.
   */
  async evaluateForPreview(
    input: EvaluatePromotionInput,
  ): Promise<PromotionDecision> {
    const code = normalizePromotionCode(input.code);
    const promotion = await this.promotions.findByNormalizedCode(code);
    if (!promotion) {
      throw promotionNotFound();
    }
    return buildPromotionDecision({
      promotion,
      eligibleBaseMinor: input.eligibleBaseMinor,
      decisionAt: input.decisionAt,
    });
  }

  /**
   * Lock + revalidate Promotion for Order create. Does not insert redemption yet
   * (Order row must exist first for FK).
   */
  async prepareOrderRedemption(
    input: {
      code: string;
      eligibleBaseMinor: number;
      decisionAt: Date;
      orderId: string;
    },
    client: OrmClient,
  ): Promise<PromotionDecision> {
    const code = normalizePromotionCode(input.code);
    const existingForOrder = await this.promotions.countRedemptionsForOrder(
      input.orderId,
      client,
    );
    if (existingForOrder > 0) {
      throw promotionStackingUnsupported();
    }

    const found = await this.promotions.findByNormalizedCode(code, client);
    if (!found) {
      throw promotionNotFound();
    }

    await this.promotions.lockPromotion(found.id, client);
    const locked = await this.promotions.findById(found.id, client);
    if (!locked) {
      throw promotionNotFound();
    }

    return buildPromotionDecision({
      promotion: locked,
      eligibleBaseMinor: input.eligibleBaseMinor,
      decisionAt: input.decisionAt,
    });
  }

  /**
   * Insert redemption after Order row exists (same TX as Order create).
   */
  async commitOrderRedemption(
    input: {
      decision: PromotionDecision;
      customerId: string;
      orderId: string;
      decisionAt: Date;
    },
    client: OrmClient,
  ): Promise<PromotionRedemptionRecord> {
    const existingForOrder = await this.promotions.countRedemptionsForOrder(
      input.orderId,
      client,
    );
    if (existingForOrder > 0) {
      throw promotionStackingUnsupported();
    }
    return this.promotions.createRedemption(
      {
        promotionId: input.decision.promotionId,
        customerId: input.customerId,
        orderId: input.orderId,
        discountAmountMinor: input.decision.discountAmountMinor,
        fundedBy: input.decision.funding,
        redeemedAt: input.decisionAt,
      },
      client,
    );
  }

  /**
   * Authoritative Order-path evaluation + redemption inside an existing TX.
   * Prefer prepareOrderRedemption + commitOrderRedemption around Order insert
   * when Order FK must exist first.
   */
  async redeemForOrder(
    input: {
      code: string;
      eligibleBaseMinor: number;
      decisionAt: Date;
      customerId: string;
      orderId: string;
    },
    client: OrmClient,
  ): Promise<{
    decision: PromotionDecision;
    redemption: PromotionRedemptionRecord;
  }> {
    const decision = await this.prepareOrderRedemption(input, client);
    const redemption = await this.commitOrderRedemption(
      {
        decision,
        customerId: input.customerId,
        orderId: input.orderId,
        decisionAt: input.decisionAt,
      },
      client,
    );
    return { decision, redemption };
  }

  async listOrderRedemptions(
    orderId: string,
    client?: OrmClient,
  ): Promise<PromotionRedemptionRecord[]> {
    return this.promotions.listRedemptionsForOrder(orderId, client);
  }
}
