import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { GeoService } from '../../application/geo.service';
import { GEO_ERROR_CODES } from '../../domain/geo.errors';
import {
  CommuneListQueryDto,
  CommuneListResponseDto,
  WilayaListResponseDto,
} from './dto/geo.dto';
import { ApiResponse } from '@nestjs/swagger';

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
}
