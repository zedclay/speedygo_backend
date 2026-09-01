import { Injectable, Logger } from '@nestjs/common';
import type {
  OtpDelivery,
  OtpSenderPort,
} from '../../domain/ports/otp-sender.port';

@Injectable()
export class ConsoleOtpSender implements OtpSenderPort {
  private readonly logger = new Logger(ConsoleOtpSender.name);

  send(delivery: OtpDelivery): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Console OTP sender refused in production');
    }
    this.logger.warn(
      `DEV OTP [${delivery.purpose}/${delivery.channel}] sent (code hidden from production logs)`,
    );
    // Development-only: code is written to stdout for local login, never via API.
    process.stdout.write(`[speedygo-dev-otp] ${delivery.code}\n`);
    return Promise.resolve();
  }
}
