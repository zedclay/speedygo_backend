import type { AuthChannel, OtpPurpose } from '../auth.types';

export const OTP_SENDER = Symbol('OTP_SENDER');

export type OtpDelivery = {
  channel: AuthChannel;
  identifier: string;
  purpose: OtpPurpose;
  code: string;
};

export interface OtpSenderPort {
  send(delivery: OtpDelivery): Promise<void>;
}
