import {
  buildLedgerReference,
  codCollectionPosting,
  codRemittancePosting,
  deriveCodCustody,
  deriveDriverPayable,
  deriveMerchantNetPayable,
  driverEarningPosting,
  electronicPaymentPosting,
  ledgerAdvisoryObjectId,
  ledgerReferencePrefix,
  merchantSettlementPosting,
  parseLedgerReference,
  refundPosting,
  requireCanonicalLedgerReference,
} from './financial-ledger.policy';
import { FINANCIAL_LEDGER_ERROR_CODES } from './financial-ledger.errors';
import {
  LEDGER_DIRECTION_CREDIT,
  LEDGER_DIRECTION_DEBIT,
  LEDGER_SOURCE_COD_COLLECTION,
  LEDGER_SOURCE_COD_REMITTANCE,
  LEDGER_SOURCE_DRIVER_EARNING,
  LEDGER_SOURCE_MERCHANT_SETTLEMENT,
  LEDGER_SOURCE_PAYMENT,
  LEDGER_SOURCE_REFUND,
  LEDGER_TYPE_COD_CUSTODY,
  LEDGER_TYPE_CUSTOMER_PAYMENT,
  LEDGER_TYPE_DRIVER_PAYABLE,
  LEDGER_TYPE_MERCHANT_PAYABLE,
  LEDGER_TYPE_REFUND,
} from './financial-ledger.types';

describe('financial-ledger.policy', () => {
  it('builds and parses structured source references', () => {
    const reference = buildLedgerReference(
      LEDGER_SOURCE_PAYMENT,
      'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
    );
    expect(reference).toBe('PAYMENT:aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa');
    expect(parseLedgerReference(reference)).toEqual({
      sourceType: 'PAYMENT',
      sourceId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
    });
  });

  it('keeps reference prefixes aligned with buildLedgerReference for reconciler SQL', () => {
    const sources = [
      LEDGER_SOURCE_PAYMENT,
      LEDGER_SOURCE_COD_COLLECTION,
      LEDGER_SOURCE_COD_REMITTANCE,
      LEDGER_SOURCE_DRIVER_EARNING,
      LEDGER_SOURCE_REFUND,
      LEDGER_SOURCE_MERCHANT_SETTLEMENT,
    ] as const;
    for (const source of sources) {
      const id = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
      expect(buildLedgerReference(source, id)).toBe(
        `${ledgerReferencePrefix(source)}${id}`,
      );
    }
  });

  it('uses the same advisory object id for identical canonical references', () => {
    const reference = buildLedgerReference(
      LEDGER_SOURCE_REFUND,
      'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
    );
    expect(ledgerAdvisoryObjectId(reference)).toBe(
      ledgerAdvisoryObjectId(reference),
    );
    expect(ledgerAdvisoryObjectId(reference)).not.toBe(
      ledgerAdvisoryObjectId(
        buildLedgerReference(
          LEDGER_SOURCE_PAYMENT,
          'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
        ),
      ),
    );
  });

  it('rejects non-canonical references', () => {
    try {
      requireCanonicalLedgerReference('PAYMENT_SUCCEEDED:x');
      fail('expected throw');
    } catch (error) {
      expect(error).toMatchObject({
        code: FINANCIAL_LEDGER_ERROR_CODES.LEDGER_INVALID_SOURCE,
      });
    }
  });

  it('posts electronic payment as CUSTOMER_PAYMENT DEBIT (not bank cash)', () => {
    expect(electronicPaymentPosting(1700)).toEqual({
      type: LEDGER_TYPE_CUSTOMER_PAYMENT,
      direction: LEDGER_DIRECTION_DEBIT,
      amountMinor: 1700n,
    });
  });

  it('posts COD collection/remittance as custody DEBIT then CREDIT', () => {
    expect(codCollectionPosting(10000)).toEqual({
      type: LEDGER_TYPE_COD_CUSTODY,
      direction: LEDGER_DIRECTION_DEBIT,
      amountMinor: 10000n,
    });
    expect(codRemittancePosting(4000)).toEqual({
      type: LEDGER_TYPE_COD_CUSTODY,
      direction: LEDGER_DIRECTION_CREDIT,
      amountMinor: 4000n,
    });
    expect(deriveCodCustody(10000n, 4000n)).toBe(6000n);
  });

  it('keeps Driver payable separate from COD custody', () => {
    expect(driverEarningPosting(1000)).toEqual({
      type: LEDGER_TYPE_DRIVER_PAYABLE,
      direction: LEDGER_DIRECTION_CREDIT,
      amountMinor: 1000n,
    });
    expect(driverEarningPosting(0)).toEqual({
      type: LEDGER_TYPE_DRIVER_PAYABLE,
      direction: LEDGER_DIRECTION_CREDIT,
      amountMinor: 0n,
    });
    expect(deriveDriverPayable(1000n, 0n)).toBe(1000n);
    expect(deriveCodCustody(10000n, 0n)).toBe(10000n);
  });

  it('posts positive/negative/zero Merchant settlements via MERCHANT_PAYABLE', () => {
    expect(merchantSettlementPosting(8000)).toEqual({
      type: LEDGER_TYPE_MERCHANT_PAYABLE,
      direction: LEDGER_DIRECTION_CREDIT,
      amountMinor: 8000n,
    });
    expect(merchantSettlementPosting(-2000)).toEqual({
      type: LEDGER_TYPE_MERCHANT_PAYABLE,
      direction: LEDGER_DIRECTION_DEBIT,
      amountMinor: 2000n,
    });
    expect(merchantSettlementPosting(0)).toEqual({
      type: LEDGER_TYPE_MERCHANT_PAYABLE,
      direction: LEDGER_DIRECTION_CREDIT,
      amountMinor: 0n,
    });
    expect(deriveMerchantNetPayable(10000n, 2000n)).toBe(8000n);
  });

  it('posts Refund as REFUND DEBIT using Refund.amountMinor only', () => {
    expect(refundPosting(4000)).toEqual({
      type: LEDGER_TYPE_REFUND,
      direction: LEDGER_DIRECTION_DEBIT,
      amountMinor: 4000n,
    });
  });

  it('rejects invalid amounts', () => {
    try {
      electronicPaymentPosting(-1);
      fail('expected throw');
    } catch (error) {
      expect(error).toMatchObject({
        code: FINANCIAL_LEDGER_ERROR_CODES.LEDGER_INVALID_AMOUNT,
      });
    }
  });
});
