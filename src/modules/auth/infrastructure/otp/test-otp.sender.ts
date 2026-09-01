import { Injectable } from '@nestjs/common';
import type {
  OtpDelivery,
  OtpSenderPort,
} from '../../domain/ports/otp-sender.port';

@Injectable()
export class TestOtpSender implements OtpSenderPort {
  lastCode: string | null = null;
  lastIdentifier: string | null = null;
  sent: OtpDelivery[] = [];

  send(delivery: OtpDelivery): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Test OTP sender refused in production');
    }
    this.lastCode = delivery.code;
    this.lastIdentifier = delivery.identifier;
    this.sent.push(delivery);
    return Promise.resolve();
  }

  reset(): void {
    this.lastCode = null;
    this.lastIdentifier = null;
    this.sent = [];
  }
}
