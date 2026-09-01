import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService, type HealthResponse } from './app.service';
import { Public } from './modules/auth/presentation/http/decorators/public.decorator';

@ApiTags('health')
@Public()
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
