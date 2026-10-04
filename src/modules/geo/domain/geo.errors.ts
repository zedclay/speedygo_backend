import { AppError } from '../../../common/errors/app.error';

export const GEO_ERROR_CODES = {
  GEO_WILAYA_NOT_FOUND: 'GEO_WILAYA_NOT_FOUND',
  GEO_COMMUNE_NOT_FOUND: 'GEO_COMMUNE_NOT_FOUND',
  GEO_COMMUNE_WILAYA_MISMATCH: 'GEO_COMMUNE_WILAYA_MISMATCH',
  GEO_LOCATION_INVALID: 'GEO_LOCATION_INVALID',
} as const;

export type GeoErrorCode =
  (typeof GEO_ERROR_CODES)[keyof typeof GEO_ERROR_CODES];

export class GeoError extends AppError {
  constructor(code: GeoErrorCode, message: string, httpStatus: number) {
    super(code, message, httpStatus);
    this.name = 'GeoError';
  }

  declare readonly code: GeoErrorCode;
}

export function geoWilayaNotFound(): GeoError {
  return new GeoError(
    GEO_ERROR_CODES.GEO_WILAYA_NOT_FOUND,
    'Wilaya was not found',
    404,
  );
}

export function geoCommuneNotFound(): GeoError {
  return new GeoError(
    GEO_ERROR_CODES.GEO_COMMUNE_NOT_FOUND,
    'Commune was not found',
    404,
  );
}

export function geoCommuneWilayaMismatch(): GeoError {
  return new GeoError(
    GEO_ERROR_CODES.GEO_COMMUNE_WILAYA_MISMATCH,
    'Commune does not belong to the selected wilaya',
    400,
  );
}

export function geoLocationInvalid(message: string): GeoError {
  return new GeoError(GEO_ERROR_CODES.GEO_LOCATION_INVALID, message, 400);
}
