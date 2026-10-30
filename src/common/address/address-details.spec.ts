import {
  applyAddressDetailsPatch,
  EMPTY_ADDRESS_DETAILS,
  readAddressDetails,
} from './address-details';

describe('address details', () => {
  it('treats omitted patch keys as unchanged and blank as clear', () => {
    const existing = {
      building: 'Bloc Z',
      floor: '3',
      entrance: 'B',
      landmark: 'Mosquée',
    };
    expect(
      applyAddressDetailsPatch(existing, { floor: null, landmark: '  ' }),
    ).toEqual({
      building: 'Bloc Z',
      floor: null,
      entrance: 'B',
      landmark: null,
    });
  });

  it('does not invent details from missing legacy rows', () => {
    expect(readAddressDetails(undefined)).toEqual(EMPTY_ADDRESS_DETAILS);
    expect(readAddressDetails({ building: '  ', floor: null })).toEqual({
      building: null,
      floor: null,
      entrance: null,
      landmark: null,
    });
  });
});
