/**
 * Optional structured address details. Street text stays in addressText.
 * Omitted PATCH keys stay unchanged; null or blank clears the column.
 * Legacy rows keep whatever is already in addressText; callers must not
 * guess structured fields from free text.
 */
export const ADDRESS_DETAIL_LIMITS = {
  building: 64,
  floor: 32,
  entrance: 64,
  landmark: 128,
} as const;

export type AddressDetailField = keyof typeof ADDRESS_DETAIL_LIMITS;

export type AddressDetails = {
  building: string | null;
  floor: string | null;
  entrance: string | null;
  landmark: string | null;
};

export type AddressDetailsPatch = {
  building?: string | null;
  floor?: string | null;
  entrance?: string | null;
  landmark?: string | null;
};

export const EMPTY_ADDRESS_DETAILS: AddressDetails = {
  building: null,
  floor: null,
  entrance: null,
  landmark: null,
};

export function readAddressDetails(
  row: Partial<AddressDetails> | null | undefined,
): AddressDetails {
  return {
    building: blankToNull(row?.building),
    floor: blankToNull(row?.floor),
    entrance: blankToNull(row?.entrance),
    landmark: blankToNull(row?.landmark),
  };
}

export function applyAddressDetailsPatch(
  existing: AddressDetails,
  patch: AddressDetailsPatch,
): AddressDetails {
  return {
    building:
      patch.building !== undefined
        ? blankToNull(patch.building)
        : existing.building,
    floor:
      patch.floor !== undefined ? blankToNull(patch.floor) : existing.floor,
    entrance:
      patch.entrance !== undefined
        ? blankToNull(patch.entrance)
        : existing.entrance,
    landmark:
      patch.landmark !== undefined
        ? blankToNull(patch.landmark)
        : existing.landmark,
  };
}

export function blankToNull(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
