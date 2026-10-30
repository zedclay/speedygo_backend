import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ReadinessService } from './infrastructure/health/readiness.service';

describe('AppController', () => {
  let appController: AppController;
  const readiness = {
    getReadiness: jest.fn(),
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: ReadinessService, useValue: readiness },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
    readiness.getReadiness.mockReset();
  });

  describe('health', () => {
    it('should return process liveness without probing dependencies', () => {
      expect(appController.getHealth()).toEqual({
        status: 'ok',
        service: 'speedygo-backend',
      });
    });
  });

  describe('ready', () => {
    it('returns 200 when dependencies are up', async () => {
      readiness.getReadiness.mockResolvedValue({
        status: 'ok',
        service: 'speedygo-backend',
        checks: { postgres: 'up', redis: 'up' },
      });
      const response = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      await appController.getReady(response as never);
      expect(response.status).toHaveBeenCalledWith(200);
      expect(response.json).toHaveBeenCalledWith({
        status: 'ok',
        service: 'speedygo-backend',
        checks: { postgres: 'up', redis: 'up' },
      });
    });

    it('returns 503 when a required dependency is down', async () => {
      readiness.getReadiness.mockResolvedValue({
        status: 'unavailable',
        service: 'speedygo-backend',
        checks: { postgres: 'down', redis: 'up' },
      });
      const response = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      await appController.getReady(response as never);
      expect(response.status).toHaveBeenCalledWith(503);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'unavailable' }),
      );
    });
  });
});
