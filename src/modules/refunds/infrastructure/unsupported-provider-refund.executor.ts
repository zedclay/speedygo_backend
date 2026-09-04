import { Injectable } from '@nestjs/common';
import type {
  ProviderRefundExecutionResult,
  RefundExecutor,
} from '../domain/refund.types';

/**
 * Chargily Pay V2 has no verified Refund resource in SpeedyGo's frozen provider
 * contract. Production must not invent POST /refunds or similar.
 */
@Injectable()
export class UnsupportedProviderRefundExecutor implements RefundExecutor {
  executeOriginalPaymentRefund(_input: {
    refundId: string;
    orderId: string;
    amountMinor: number;
    currency: string;
    paymentTransactionId: string;
    paymentProviderReference: string | null;
  }): Promise<ProviderRefundExecutionResult> {
    return Promise.resolve({
      supported: false,
      reason:
        'Official Chargily Pay V2 refund execution is not available in the verified SpeedyGo provider contract',
    });
  }
}
