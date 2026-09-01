import { Injectable } from '@nestjs/common';
import { APP_NAME } from './common/constants/api.constants';

export type HealthResponse = {
  status: 'ok';
  service: string;
};

@Injectable()
export class AppService {
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      service: APP_NAME,
    };
  }
}
