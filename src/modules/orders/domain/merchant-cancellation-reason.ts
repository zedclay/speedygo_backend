/** Structured Merchant reject codes stored on OrderCancellation.reasonCode. */
export const MERCHANT_CANCELLATION_REASON_CODES = [
  'PRODUCT_UNAVAILABLE',
  'TOO_BUSY',
  'CLOSING_SOON',
  'OTHER',
] as const;

export type MerchantCancellationReasonCode =
  (typeof MERCHANT_CANCELLATION_REASON_CODES)[number];

/** API grouping key when reasonCode is null (legacy). */
export const MERCHANT_CANCELLATION_REASON_UNSET = 'UNSET';

export const MERCHANT_CANCELLATION_REASON_LABELS_FR: Record<
  MerchantCancellationReasonCode | typeof MERCHANT_CANCELLATION_REASON_UNSET,
  string
> = {
  PRODUCT_UNAVAILABLE: 'Indisponibilité produit',
  TOO_BUSY: 'Trop occupé',
  CLOSING_SOON: 'Fermeture proche',
  OTHER: 'Autre',
  UNSET: 'Non renseignée',
};

export function isMerchantCancellationReasonCode(
  value: string | null | undefined,
): value is MerchantCancellationReasonCode {
  return (
    value != null &&
    (MERCHANT_CANCELLATION_REASON_CODES as readonly string[]).includes(value)
  );
}

export function cancellationReasonGroupKey(
  reasonCode: string | null | undefined,
): string {
  if (isMerchantCancellationReasonCode(reasonCode)) return reasonCode;
  return MERCHANT_CANCELLATION_REASON_UNSET;
}
