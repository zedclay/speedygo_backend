import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService, type HealthResponse } from './app.service';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Service identity (foundation)' })
  getRoot(): HealthResponse {
    return this.appService.getHealth();
  }

  @Get('health')
  @ApiOperation({ summary: 'Liveness probe' })
  getHealth(): HealthResponse {
    return this.appService.getHealth();
  }
}
