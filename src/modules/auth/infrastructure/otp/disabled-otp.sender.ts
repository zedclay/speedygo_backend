import { Injectable } from '@nestjs/common';
import type {
  OtpDelivery,
  OtpSenderPort,
} from '../../domain/ports/otp-sender.port';

@Injectable()
export class DisabledOtpSender implements OtpSenderPort {
  send(_delivery: OtpDelivery): Promise<void> {
    return Promise.resolve();
  }
}
