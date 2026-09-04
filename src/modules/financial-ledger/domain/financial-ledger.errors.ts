import { AppError } from '../../../common/errors/app.error';

export const FINANCIAL_LEDGER_ERROR_CODES = {
  LEDGER_INVALID_AMOUNT: 'LEDGER_INVALID_AMOUNT',
  LEDGER_INVALID_CURRENCY: 'LEDGER_INVALID_CURRENCY',
  LEDGER_INVALID_SOURCE: 'LEDGER_INVALID_SOURCE',
  LEDGER_SOURCE_NOT_ELIGIBLE: 'LEDGER_SOURCE_NOT_ELIGIBLE',
  LEDGER_FINANCIAL_STATE_INVALID: 'LEDGER_FINANCIAL_STATE_INVALID',
  LEDGER_REFERENCE_AMBIGUOUS: 'LEDGER_REFERENCE_AMBIGUOUS',
  LEDGER_DUPLICATE: 'LEDGER_DUPLICATE',
} as const;

export type FinancialLedgerErrorCode =
  (typeof FINANCIAL_LEDGER_ERROR_CODES)[keyof typeof FINANCIAL_LEDGER_ERROR_CODES];

export class FinancialLedgerError extends AppError {
  constructor(
    readonly code: FinancialLedgerErrorCode,
    message: string,
    httpStatus: number,
  ) {
    super(code, message, httpStatus);
    this.name = 'FinancialLedgerError';
  }
}

export function ledgerInvalidAmount(
  message = 'Ledger amount is invalid',
): FinancialLedgerError {
  return new FinancialLedgerError(
    FINANCIAL_LEDGER_ERROR_CODES.LEDGER_INVALID_AMOUNT,
    message,
    400,
  );
}

export function ledgerInvalidCurrency(
  message = 'Ledger currency must be DZD',
): FinancialLedgerError {
  return new FinancialLedgerError(
    FINANCIAL_LEDGER_ERROR_CODES.LEDGER_INVALID_CURRENCY,
    message,
    400,
  );
}

export function ledgerInvalidSource(
  message = 'Ledger source identity is invalid',
): FinancialLedgerError {
  return new FinancialLedgerError(
    FINANCIAL_LEDGER_ERROR_CODES.LEDGER_INVALID_SOURCE,
    message,
    400,
  );
}

export function ledgerSourceNotEligible(
  message = 'Source event is not eligible for ledger posting',
): FinancialLedgerError {
  return new FinancialLedgerError(
    FINANCIAL_LEDGER_ERROR_CODES.LEDGER_SOURCE_NOT_ELIGIBLE,
    message,
    409,
  );
}

export function ledgerFinancialStateInvalid(
  message = 'Ledger financial state is invalid',
): FinancialLedgerError {
  return new FinancialLedgerError(
    FINANCIAL_LEDGER_ERROR_CODES.LEDGER_FINANCIAL_STATE_INVALID,
    message,
    409,
  );
}

export function ledgerReferenceAmbiguous(
  message = 'Multiple ledger entries share the same source reference',
): FinancialLedgerError {
  return new FinancialLedgerError(
    FINANCIAL_LEDGER_ERROR_CODES.LEDGER_REFERENCE_AMBIGUOUS,
    message,
    409,
  );
}
