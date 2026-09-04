import { Injectable } from '@nestjs/common';
import {
  buildLedgerReference,
  codCollectionPosting,
  codRemittancePosting,
  deriveCodCustody,
  deriveDriverPayable,
  deriveMerchantNetPayable,
  driverEarningPosting,
  electronicPaymentPosting,
  merchantSettlementPosting,
  normalizeLedgerListQuery,
  refundPosting,
  requireCanonicalLedgerReference,
  requireDzd,
} from '../domain/financial-ledger.policy';
import {
  LEDGER_CURRENCY_DZD,
  LEDGER_DIRECTION_CREDIT,
  LEDGER_DIRECTION_DEBIT,
  LEDGER_SOURCE_COD_COLLECTION,
  LEDGER_SOURCE_COD_REMITTANCE,
  LEDGER_SOURCE_DRIVER_EARNING,
  LEDGER_SOURCE_MERCHANT_SETTLEMENT,
  LEDGER_SOURCE_PAYMENT,
  LEDGER_SOURCE_REFUND,
  LEDGER_TYPE_COD_CUSTODY,
  LEDGER_TYPE_DRIVER_PAYABLE,
  LEDGER_TYPE_MERCHANT_PAYABLE,
  type DriverLedgerPositions,
  type FinancialLedgerEntryRecord,
  type LedgerListQuery,
  type MerchantLedgerPosition,
} from '../domain/financial-ledger.types';
import {
  FinancialLedgerRepository,
  type OrmClient,
} from '../infrastructure/financial-ledger.repository';

@Injectable()
export class FinancialLedgerService {
  constructor(private readonly ledger: FinancialLedgerRepository) {}

  /**
   * Idempotent insert under transaction-scoped advisory lock on canonical reference.
   * Never updates/deletes existing entries. Fail-closed if reference is ambiguous.
   */
  async postIdempotent(
    input: {
      orderId: string | null;
      merchantId: string | null;
      driverId: string | null;
      type: string;
      direction: 'DEBIT' | 'CREDIT';
      amountMinor: number;
      currency: string;
      reference: string;
    },
    client?: OrmClient,
  ): Promise<FinancialLedgerEntryRecord> {
    requireDzd(input.currency);
    const reference = requireCanonicalLedgerReference(input.reference);
    const run = async (tx: OrmClient) => {
      await this.ledger.lockReference(reference, tx);
      const existing = await this.ledger.findByReference(reference, tx);
      if (existing) {
        return existing;
      }
      return this.ledger.createEntry(
        {
          orderId: input.orderId,
          merchantId: input.merchantId,
          driverId: input.driverId,
          type: input.type,
          direction: input.direction,
          amountMinor: input.amountMinor,
          currency: LEDGER_CURRENCY_DZD,
          reference,
        },
        tx,
      );
    };
    if (client) {
      return run(client);
    }
    return this.ledger.runInTransaction(run);
  }

  /** ELECTRONIC Payment SUCCEEDED → CUSTOMER_PAYMENT DEBIT (provider clearing, not bank cash). */
  async postElectronicPaymentSucceeded(
    input: {
      paymentId: string;
      orderId: string;
      amountMinor: number;
      currency: string;
    },
    client?: OrmClient,
  ): Promise<FinancialLedgerEntryRecord> {
    requireDzd(input.currency);
    const amounts = electronicPaymentPosting(input.amountMinor);
    return this.postIdempotent(
      {
        orderId: input.orderId,
        merchantId: null,
        driverId: null,
        ...amounts,
        currency: LEDGER_CURRENCY_DZD,
        reference: buildLedgerReference(LEDGER_SOURCE_PAYMENT, input.paymentId),
      },
      client,
    );
  }

  /** CodCollection COLLECTED → COD_CUSTODY DEBIT. COD Payment SUCCEEDED does not post CUSTOMER_PAYMENT. */
  async postCodCollection(
    input: {
      collectionId: string;
      orderId: string;
      driverId: string;
      amountMinor: number;
    },
    client?: OrmClient,
  ): Promise<FinancialLedgerEntryRecord> {
    const amounts = codCollectionPosting(input.amountMinor);
    return this.postIdempotent(
      {
        orderId: input.orderId,
        merchantId: null,
        driverId: input.driverId,
        ...amounts,
        currency: LEDGER_CURRENCY_DZD,
        reference: buildLedgerReference(
          LEDGER_SOURCE_COD_COLLECTION,
          input.collectionId,
        ),
      },
      client,
    );
  }

  /** CodRemittance CONFIRMED → COD_CUSTODY CREDIT. Allocations are attribution only. */
  async postCodRemittanceConfirmed(
    input: {
      remittanceId: string;
      driverId: string;
      confirmedAmountMinor: number;
    },
    client?: OrmClient,
  ): Promise<FinancialLedgerEntryRecord> {
    const amounts = codRemittancePosting(input.confirmedAmountMinor);
    return this.postIdempotent(
      {
        orderId: null,
        merchantId: null,
        driverId: input.driverId,
        ...amounts,
        currency: LEDGER_CURRENCY_DZD,
        reference: buildLedgerReference(
          LEDGER_SOURCE_COD_REMITTANCE,
          input.remittanceId,
        ),
      },
      client,
    );
  }

  /** DriverEarning EARNED → DRIVER_PAYABLE CREDIT. Zero amount is posted (audit marker). */
  async postDriverEarning(
    input: {
      earningId: string;
      orderId: string;
      driverId: string;
      netEarningMinor: number;
    },
    client?: OrmClient,
  ): Promise<FinancialLedgerEntryRecord> {
    const amounts = driverEarningPosting(input.netEarningMinor);
    return this.postIdempotent(
      {
        orderId: input.orderId,
        merchantId: null,
        driverId: input.driverId,
        ...amounts,
        currency: LEDGER_CURRENCY_DZD,
        reference: buildLedgerReference(
          LEDGER_SOURCE_DRIVER_EARNING,
          input.earningId,
        ),
      },
      client,
    );
  }

  /**
   * MerchantSettlement FINALIZED aggregate only (not per-line).
   * Positive → CREDIT; negative → DEBIT abs; zero → CREDIT 0.
   */
  async postMerchantSettlementFinalized(
    input: {
      settlementId: string;
      merchantId: string;
      netPayableMinor: number;
    },
    client?: OrmClient,
  ): Promise<FinancialLedgerEntryRecord> {
    const amounts = merchantSettlementPosting(input.netPayableMinor);
    return this.postIdempotent(
      {
        orderId: null,
        merchantId: input.merchantId,
        driverId: null,
        ...amounts,
        currency: LEDGER_CURRENCY_DZD,
        reference: buildLedgerReference(
          LEDGER_SOURCE_MERCHANT_SETTLEMENT,
          input.settlementId,
        ),
      },
      client,
    );
  }

  /** Refund REFUNDED → REFUND DEBIT (Customer return truth; not bank-accounted). */
  async postRefundRefunded(
    input: {
      refundId: string;
      orderId: string;
      amountMinor: number;
    },
    client?: OrmClient,
  ): Promise<FinancialLedgerEntryRecord> {
    const amounts = refundPosting(input.amountMinor);
    return this.postIdempotent(
      {
        orderId: input.orderId,
        merchantId: null,
        driverId: null,
        ...amounts,
        currency: LEDGER_CURRENCY_DZD,
        reference: buildLedgerReference(LEDGER_SOURCE_REFUND, input.refundId),
      },
      client,
    );
  }

  async getBySourceReference(
    reference: string,
  ): Promise<FinancialLedgerEntryRecord | null> {
    return this.ledger.findByReference(
      requireCanonicalLedgerReference(reference),
    );
  }

  async listEntries(
    query: LedgerListQuery,
  ): Promise<{ items: FinancialLedgerEntryRecord[]; total: number }> {
    const page = normalizeLedgerListQuery(query);
    return this.ledger.list({ ...query, ...page });
  }

  /** Category-local MERCHANT_PAYABLE position only. Not a global ledger balance. */
  async getMerchantPosition(
    merchantId: string,
  ): Promise<MerchantLedgerPosition> {
    const creditMinor = await this.ledger.sumDirectionForMerchant(
      merchantId,
      LEDGER_TYPE_MERCHANT_PAYABLE,
      LEDGER_DIRECTION_CREDIT,
    );
    const debitMinor = await this.ledger.sumDirectionForMerchant(
      merchantId,
      LEDGER_TYPE_MERCHANT_PAYABLE,
      LEDGER_DIRECTION_DEBIT,
    );
    return {
      merchantId,
      currency: LEDGER_CURRENCY_DZD,
      creditMinor,
      debitMinor,
      netPayableMinor: deriveMerchantNetPayable(creditMinor, debitMinor),
    };
  }

  /**
   * Category-local Driver positions. Never combine payable + custody into one balance.
   */
  async getDriverPositions(driverId: string): Promise<DriverLedgerPositions> {
    const payableCredit = await this.ledger.sumDirectionForDriver(
      driverId,
      LEDGER_TYPE_DRIVER_PAYABLE,
      LEDGER_DIRECTION_CREDIT,
    );
    const payableDebit = await this.ledger.sumDirectionForDriver(
      driverId,
      LEDGER_TYPE_DRIVER_PAYABLE,
      LEDGER_DIRECTION_DEBIT,
    );
    const custodyDebit = await this.ledger.sumDirectionForDriver(
      driverId,
      LEDGER_TYPE_COD_CUSTODY,
      LEDGER_DIRECTION_DEBIT,
    );
    const custodyCredit = await this.ledger.sumDirectionForDriver(
      driverId,
      LEDGER_TYPE_COD_CUSTODY,
      LEDGER_DIRECTION_CREDIT,
    );
    return {
      driverId,
      currency: LEDGER_CURRENCY_DZD,
      driverPayableMinor: deriveDriverPayable(payableCredit, payableDebit),
      codCustodyMinor: deriveCodCustody(custodyDebit, custodyCredit),
    };
  }

  /**
   * Bounded internal reconciler — recovery/audit only, not the primary posting path.
   * Uses the same post* methods (same canonical reference + advisory lock) as same-TX hooks.
   * Does NOT automatically backfill production history on startup/deploy.
   */
  async reconcileUnposted(limit = 50): Promise<{ posted: number }> {
    const batch = Math.min(100, Math.max(1, Math.floor(limit)));
    let posted = 0;

    for (const row of await this.ledger.findUnpostedElectronicPayments(batch)) {
      await this.postElectronicPaymentSucceeded(row);
      posted += 1;
    }
    for (const row of await this.ledger.findUnpostedCodCollections(batch)) {
      await this.postCodCollection(row);
      posted += 1;
    }
    for (const row of await this.ledger.findUnpostedCodRemittances(batch)) {
      await this.postCodRemittanceConfirmed({
        remittanceId: row.remittanceId,
        driverId: row.driverId,
        confirmedAmountMinor: row.amountMinor,
      });
      posted += 1;
    }
    for (const row of await this.ledger.findUnpostedDriverEarnings(batch)) {
      await this.postDriverEarning({
        earningId: row.earningId,
        orderId: row.orderId,
        driverId: row.driverId,
        netEarningMinor: row.amountMinor,
      });
      posted += 1;
    }
    for (const row of await this.ledger.findUnpostedRefunds(batch)) {
      await this.postRefundRefunded(row);
      posted += 1;
    }
    for (const row of await this.ledger.findUnpostedMerchantSettlements(
      batch,
    )) {
      await this.postMerchantSettlementFinalized(row);
      posted += 1;
    }

    return { posted };
  }
}
