import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { GeoService } from '../../application/geo.service';
import { GEO_ERROR_CODES } from '../../domain/geo.errors';
import {
  CommuneListQueryDto,
  CommuneListResponseDto,
  PlaceAutocompleteQueryDto,
  PlaceAutocompleteResponseDto,
  PlaceDetailsQueryDto,
  PlaceDetailsResponseDto,
  ReverseGeocodeQueryDto,
  ReverseGeocodeResponseDto,
  WilayaListResponseDto,
} from './dto/geo.dto';

@ApiTags('geo')
@ApiBearerAuth()
@Controller('geo')
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  @Get('wilayas')
  @ApiOperation({
    summary: 'List Algeria wilayas',
    description:
      'Authenticated. Returns the platform administrative catalogue (69 wilayas). Not a delivery-zone list.',
  })
  @ApiOkResponse({ type: WilayaListResponseDto })
  listWilayas() {
    return this.geo.listWilayas();
  }

  @Get('wilayas/:wilayaCode/communes')
  @ApiOperation({
    summary: 'List communes for a wilaya',
    description:
      'Authenticated. Optional q filters by French/Arabic name or French aliases. Returns GEO_WILAYA_NOT_FOUND when the wilaya code is unknown.',
  })
  @ApiOkResponse({ type: CommuneListResponseDto })
  @ApiResponse({
    status: 404,
    description: GEO_ERROR_CODES.GEO_WILAYA_NOT_FOUND,
  })
  listCommunes(
    @Param('wilayaCode') wilayaCode: string,
    @Query() query: CommuneListQueryDto,
  ) {
    return this.geo.listCommunes(wilayaCode, query.q);
  }

  @Get('places/autocomplete')
  @ApiOperation({
    summary: 'Algeria-biased place suggestions',
    description:
      'Authenticated. Proxies Google Places Autocomplete (New) with includedRegionCodes=dz. Returns 503 GEO_GEOCODING_NOT_CONFIGURED when GOOGLE_MAPS_API_KEY is empty. Clients must not invent suggestions.',
  })
  @ApiOkResponse({ type: PlaceAutocompleteResponseDto })
  @ApiResponse({
    status: 503,
    description: GEO_ERROR_CODES.GEO_GEOCODING_NOT_CONFIGURED,
  })
  autocomplete(@Query() query: PlaceAutocompleteQueryDto) {
    return this.geo.autocompletePlaces({
      q: query.q,
      language: query.language,
      sessionToken: query.sessionToken,
    });
  }

  @Get('geocode/reverse')
  @ApiOperation({
    summary: 'Reverse-geocode a confirmed map pin',
    description:
      'Authenticated. Proxies Google Geocoding latlng. Returns 503 when GOOGLE_MAPS_API_KEY is empty. The client must ignore stale responses after the user moves the pin.',
  })
  @ApiOkResponse({ type: ReverseGeocodeResponseDto })
  @ApiResponse({
    status: 503,
    description: GEO_ERROR_CODES.GEO_GEOCODING_NOT_CONFIGURED,
  })
  reverse(@Query() query: ReverseGeocodeQueryDto) {
    return this.geo.reverseGeocode({
      latitude: query.latitude,
      longitude: query.longitude,
      language: query.language,
    });
  }

  @Get('places/details')
  @ApiOperation({
    summary: 'Resolve a tapped place suggestion',
    description:
      'Authenticated. Proxies Google Place Details (New). Returns 503 GEO_GEOCODING_NOT_CONFIGURED when GOOGLE_MAPS_API_KEY is empty. Clients must move the map to this point and still require explicit pin confirmation.',
  })
  @ApiOkResponse({ type: PlaceDetailsResponseDto })
  @ApiResponse({
    status: 503,
    description: GEO_ERROR_CODES.GEO_GEOCODING_NOT_CONFIGURED,
  })
  placeDetails(@Query() query: PlaceDetailsQueryDto) {
    return this.geo.resolvePlace({
      placeId: query.placeId,
      language: query.language,
      sessionToken: query.sessionToken,
    });
  }
}
