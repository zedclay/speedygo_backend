# Domain modules

Placeholder folders for the SpeedyGo modular monolith.

`auth`, `identity`, and `authorization` contain the Authentication Foundation v1.0. Other folders remain empty until their approved domain tasks.

Do not implement Customer/Driver/Merchant onboarding or order/payment flows here as part of auth work.

| Module | Responsibility (future) |
| --- | --- |
| `auth` | OTP, sessions, JWT access, opaque refresh |
| `identity` | Account / Device / Session persistence |
| `authorization` | Admin RBAC guards (no admin login yet) |
| `customers` | Customer accounts |
| `drivers` | Driver accounts and availability |
| `merchants` | Merchant accounts |
| `catalog` | Merchant catalog |
| `orders` | Order lifecycle (not delivery/payment/refund) |
| `delivery` | Delivery assignment and tracking |
| `zones` | Service zones |
| `pricing` | Delivery pricing versions |
| `merchant-commissions` | Commission configuration (future orders only) |
| `driver-remuneration` | Driver pay (not COD cash) |
| `payments` | Payment intents and status |
| `cod` | Cash-on-delivery collection and reconciliation |
| `refunds` | Refund lifecycle (not cancellation) |
| `promotions` | Promotions and discounts |
| `notifications` | Push / in-app / email / SMS dispatch |
| `support` | Support tickets |
| `reports` | Reporting read models |
| `admin` | Admin operations |
| `audit` | Audit log |
| `settings` | System settings |
