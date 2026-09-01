export const CHECKOUT_CLOCK = 'CHECKOUT_CLOCK';

export interface CheckoutClock {
  now(): Date;
}

export class SystemCheckoutClock implements CheckoutClock {
  now(): Date {
    return new Date();
  }
}
