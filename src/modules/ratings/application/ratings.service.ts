import { Injectable } from '@nestjs/common';
import { isPostgresUniqueViolation } from '../../../common/errors/postgres-unique';
import {
  ratingAlreadyExists,
  ratingForbidden,
  ratingInvalidInput,
  ratingInvalidState,
  ratingNotFound,
  ratingSelfNotAllowed,
} from '../domain/ratings.errors';
import {
  formatRatingAverage,
  isOrderEligibleForRating,
  normalizeRatingComment,
  parseRatingScore,
  RATING_TARGET_DRIVER,
  RATING_TARGET_MERCHANT,
} from '../domain/ratings.policy';
import {
  toDriverRatingDto,
  toMerchantRatingDto,
  type DriverRatingDto,
  type MerchantRatingDto,
  type RatingSummaryDto,
} from '../domain/ratings.types';
import { RatingsRepository } from '../infrastructure/ratings.repository';

@Injectable()
export class RatingsService {
  constructor(private readonly ratings: RatingsRepository) {}

  private async requireCustomerProfile(accountId: string): Promise<{
    id: string;
    accountId: string;
  }> {
    const profile =
      await this.ratings.findCustomerProfileByAccountId(accountId);
    if (!profile) {
      throw ratingForbidden('CustomerProfile is required to rate');
    }
    return profile;
  }

  private parseCreateInput(
    scoreRaw: unknown,
    commentRaw: unknown,
  ): {
    score: number;
    comment: string | null;
  } {
    const score = parseRatingScore(scoreRaw);
    if (score === null) {
      throw ratingInvalidInput('score must be an integer from 1 to 5');
    }
    const comment = normalizeRatingComment(
      commentRaw as string | null | undefined,
    );
    if (!comment.ok) {
      throw ratingInvalidInput(
        'comment must be plain text up to 2000 characters when provided',
      );
    }
    return { score, comment: comment.comment };
  }

  private async assertCustomerOwnsOrder(
    customerId: string,
    orderId: string,
  ): Promise<boolean> {
    const order = await this.ratings.findOrderOwnership(orderId);
    return Boolean(order && order.customerId === customerId);
  }

  async rateMerchant(
    accountId: string,
    orderId: string,
    scoreRaw: unknown,
    commentRaw?: unknown,
  ): Promise<MerchantRatingDto> {
    const customer = await this.requireCustomerProfile(accountId);
    const { score, comment } = this.parseCreateInput(scoreRaw, commentRaw);

    try {
      return await this.ratings.runInTransaction(async (tx) => {
        const order = await this.ratings.lockEligibleOrderContext(orderId, tx);
        if (!order || order.customerId !== customer.id) {
          throw ratingNotFound('Order not found for this Customer');
        }
        if (!isOrderEligibleForRating(order.status)) {
          throw ratingInvalidState(
            'Order must be COMPLETED before Merchant rating',
          );
        }

        if (await this.ratings.isMerchantMember(order.merchantId, accountId)) {
          throw ratingSelfNotAllowed(
            'Customer cannot rate a Merchant they belong to',
          );
        }

        const existing = await this.ratings.findMerchantRatingByOrderCustomer(
          orderId,
          customer.id,
          tx,
        );
        if (existing) {
          throw ratingAlreadyExists();
        }

        const created = await this.ratings.createMerchantRating(
          {
            orderId,
            customerId: customer.id,
            merchantId: order.merchantId,
            score,
            comment,
          },
          tx,
        );
        return toMerchantRatingDto(created);
      });
    } catch (error) {
      if (isPostgresUniqueViolation(error)) {
        throw ratingAlreadyExists();
      }
      throw error;
    }
  }

  async rateDriver(
    accountId: string,
    orderId: string,
    scoreRaw: unknown,
    commentRaw?: unknown,
  ): Promise<DriverRatingDto> {
    const customer = await this.requireCustomerProfile(accountId);
    const { score, comment } = this.parseCreateInput(scoreRaw, commentRaw);

    try {
      return await this.ratings.runInTransaction(async (tx) => {
        const order = await this.ratings.lockEligibleOrderContext(orderId, tx);
        if (!order || order.customerId !== customer.id) {
          throw ratingNotFound('Order not found for this Customer');
        }
        if (!isOrderEligibleForRating(order.status)) {
          throw ratingInvalidState(
            'Order must be COMPLETED before Driver rating',
          );
        }

        const delivered = await this.ratings.findDeliveredDriverId(orderId, tx);
        if (!delivered) {
          throw ratingInvalidState(
            'Delivery must be DELIVERED with a deterministic historical serving Driver',
          );
        }

        const ownDriver =
          await this.ratings.findDriverProfileByAccountId(accountId);
        if (ownDriver && ownDriver.id === delivered.driverId) {
          throw ratingSelfNotAllowed(
            'Customer cannot rate themselves as Driver',
          );
        }

        const existing = await this.ratings.findDriverRatingByOrderCustomer(
          orderId,
          customer.id,
          tx,
        );
        if (existing) {
          throw ratingAlreadyExists();
        }

        const created = await this.ratings.createDriverRating(
          {
            orderId,
            customerId: customer.id,
            driverId: delivered.driverId,
            score,
            comment,
          },
          tx,
        );
        return toDriverRatingDto(created);
      });
    } catch (error) {
      if (isPostgresUniqueViolation(error)) {
        throw ratingAlreadyExists();
      }
      throw error;
    }
  }

  async getOwnMerchantRating(
    accountId: string,
    orderId: string,
  ): Promise<MerchantRatingDto> {
    const customer = await this.requireCustomerProfile(accountId);
    if (!(await this.assertCustomerOwnsOrder(customer.id, orderId))) {
      throw ratingNotFound('Order not found for this Customer');
    }
    const rating = await this.ratings.findMerchantRatingByOrderCustomer(
      orderId,
      customer.id,
    );
    if (!rating) {
      throw ratingNotFound();
    }
    return toMerchantRatingDto(rating);
  }

  async getOwnDriverRating(
    accountId: string,
    orderId: string,
  ): Promise<DriverRatingDto> {
    const customer = await this.requireCustomerProfile(accountId);
    if (!(await this.assertCustomerOwnsOrder(customer.id, orderId))) {
      throw ratingNotFound('Order not found for this Customer');
    }
    const rating = await this.ratings.findDriverRatingByOrderCustomer(
      orderId,
      customer.id,
    );
    if (!rating) {
      throw ratingNotFound();
    }
    return toDriverRatingDto(rating);
  }

  async merchantSummary(merchantId: string): Promise<RatingSummaryDto> {
    if (!(await this.ratings.merchantExists(merchantId))) {
      throw ratingNotFound('Merchant not found');
    }
    const { count, sum } =
      await this.ratings.aggregateMerchantRatings(merchantId);
    return {
      targetType: RATING_TARGET_MERCHANT,
      targetId: merchantId,
      count,
      average: formatRatingAverage(sum, count),
    };
  }

  async driverSummary(driverId: string): Promise<RatingSummaryDto> {
    if (!(await this.ratings.driverExists(driverId))) {
      throw ratingNotFound('Driver not found');
    }
    const { count, sum } = await this.ratings.aggregateDriverRatings(driverId);
    return {
      targetType: RATING_TARGET_DRIVER,
      targetId: driverId,
      count,
      average: formatRatingAverage(sum, count),
    };
  }

  async ownDriverSummary(accountId: string): Promise<RatingSummaryDto> {
    const profile = await this.ratings.findDriverProfileByAccountId(accountId);
    if (!profile) {
      throw ratingForbidden('DriverProfile is required');
    }
    return this.driverSummary(profile.id);
  }
}
