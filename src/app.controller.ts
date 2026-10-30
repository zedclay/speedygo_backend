import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AppService, type HealthResponse } from './app.service';
import { ReadinessService } from './infrastructure/health/readiness.service';
import { Public } from './modules/auth/presentation/http/decorators/public.decorator';

@ApiTags('health')
@Public()
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly readiness: ReadinessService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Service identity (foundation)' })
  getRoot(): HealthResponse {
    return this.appService.getHealth();
  }

  @Get('health')
  @ApiOperation({ summary: 'Process liveness (does not probe dependencies)' })
  getHealth(): HealthResponse {
    return this.appService.getHealth();
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Dependency readiness (PostgreSQL + Redis). 503 when unavailable.',
  })
  async getReady(@Res() response: Response): Promise<void> {
    const body = await this.readiness.getReadiness();
    const status = body.status === 'ok' ? 200 : 503;
    response.status(status).json(body);
  }
}
