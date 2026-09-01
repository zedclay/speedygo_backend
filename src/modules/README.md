# Domain modules

Placeholder folders for the SpeedyGo modular monolith.

`auth`, `identity`, and `authorization` contain the Authentication Foundation v1.0. `customers` contains the Customer Onboarding Foundation v1.0. `merchants` contains the Merchant Foundation v1.0. `catalog` contains the Catalog Foundation v1.0 (branch-owned categories, products, and options). `cart` contains the Cart Foundation v1.0 (Customer Active Cart). `checkout` contains Checkout Foundation v1.0 (live preview only; no Order creation). `orders` contains Order Foundation v1.0 (Customer Order creation and historical reads). Other folders remain empty until their approved domain tasks.

Do not implement Merchant order workflow, payment provider integration, COD collection, or driver assignment as part of Order Foundation.

| Module | Responsibility |
| --- | --- |
| `auth` | OTP, sessions, JWT access, opaque refresh |
| `identity` | Account / Device / Session persistence |
| `authorization` | Admin RBAC guards (no admin login yet) |
| `customers` | CustomerProfile onboarding, profile management, addresses |
| `drivers` | Driver accounts and availability |
| `merchants` | Merchant organization, membership access, branches |
| `catalog` | Merchant catalog |
| `cart` | Customer Active Cart |
| `checkout` | Checkout Preview (validation + delivery fee; no Order) |
| `orders` | Order creation snapshots and Customer reads (not Merchant workflow / delivery / payment provider) |
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
