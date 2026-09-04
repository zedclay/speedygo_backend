import type { RatingTargetType } from './ratings.policy';

export type DriverRatingRecord = {
  id: string;
  orderId: string;
  customerId: string;
  driverId: string;
  score: number;
  comment: string | null;
  createdAt: string;
};

export type MerchantRatingRecord = {
  id: string;
  orderId: string;
  customerId: string;
  merchantId: string;
  score: number;
  comment: string | null;
  createdAt: string;
};

export type RatingSummaryDto = {
  targetType: RatingTargetType;
  targetId: string;
  count: number;
  /** Null when count is 0. Two decimal places when present. */
  average: number | null;
};

export type DriverRatingDto = {
  id: string;
  orderId: string;
  targetType: 'DRIVER';
  driverId: string;
  score: number;
  comment: string | null;
  createdAt: string;
};

export type MerchantRatingDto = {
  id: string;
  orderId: string;
  targetType: 'MERCHANT';
  merchantId: string;
  score: number;
  comment: string | null;
  createdAt: string;
};

export function toDriverRatingDto(row: DriverRatingRecord): DriverRatingDto {
  return {
    id: row.id,
    orderId: row.orderId,
    targetType: 'DRIVER',
    driverId: row.driverId,
    score: row.score,
    comment: row.comment,
    createdAt: row.createdAt,
  };
}

export function toMerchantRatingDto(
  row: MerchantRatingRecord,
): MerchantRatingDto {
  return {
    id: row.id,
    orderId: row.orderId,
    targetType: 'MERCHANT',
    merchantId: row.merchantId,
    score: row.score,
    comment: row.comment,
    createdAt: row.createdAt,
  };
}

export type EligibleOrderContext = {
  orderId: string;
  customerId: string;
  status: string;
  merchantId: string;
  merchantBranchId: string;
};
