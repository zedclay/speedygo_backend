# Domain modules

Placeholder folders for the SpeedyGo modular monolith.

Each folder will become a NestJS module **after** domain, ERD, and state-machine approval.

Do not implement business logic in these folders during foundation work.

| Module | Responsibility (future) |
| --- | --- |
| `auth` | Authentication flows |
| `identity` | Users, profiles, verification |
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
| `authorization` | Roles and permissions |
| `audit` | Audit log |
| `settings` | System settings |
