# Domain modules

Placeholder folders for the SpeedyGo modular monolith.

`auth`, `identity`, and `authorization` contain the Authentication Foundation v1.0. `customers` contains the Customer Onboarding Foundation v1.0. `merchants` contains the Merchant Foundation v1.0. `catalog` contains the Catalog Foundation v1.0 (branch-owned categories, products, and options). `cart` contains the Cart Foundation v1.0 (Customer Active Cart). `checkout` contains Checkout Foundation v1.0 (live preview only; no Order creation). `orders` contains Order Foundation v1.0 (Customer Order creation and historical reads) and Merchant Order Workflow v1.0 (accept / reject / prepare / ready). `delivery` contains Delivery Foundation v1.0 (internal Delivery aggregate when Driver Matching starts; Customer/Merchant reads) and Driver Delivery Workflow v1.0 (explicit assigned-Driver logistics actions after Matching accept). `drivers` contains Driver Foundation & Onboarding v1.0. `matching` contains Driver Matching v1.0 (sequential offers, BullMQ orchestration/recovery, accept/reject/timeout). `tracking` contains Realtime Tracking Foundation v1.0 (authenticated location ingest, assignment-authorized Socket.IO rooms). `payments` contains Payments Foundation v1.0 **FINAL FREEZE** (Chargily Pay V2 production adapter, ELECTRONIC Payment execution, PaymentTransaction history, verified webhooks). `cod` contains COD Foundation v1.0 (exact cash collection, Payment SUCCEEDED, Driver custody, DECLARED remittance, internal CONFIRMED allocation). `merchant-commissions` contains Merchant Commission Foundation v1.0 (GLOBAL_DEFAULT / MERCHANT_OVERRIDE, future-order snapshots). Other folders remain empty until their approved domain tasks.

Do not implement Refund execution or Driver remuneration as part of COD Foundation.

| Module | Responsibility |
| --- | --- |
| `auth` | OTP, sessions, JWT access, opaque refresh |
| `identity` | Account / Device / Session persistence |
| `authorization` | Admin RBAC guards (no admin login yet) |
| `customers` | CustomerProfile onboarding, profile management, addresses |
| `drivers` | Driver onboarding, verification metadata, vehicle, availability |
| `merchants` | Merchant organization, membership access, branches |
| `catalog` | Merchant catalog |
| `cart` | Customer Active Cart |
| `checkout` | Checkout Preview (validation + delivery fee; no Order) |
| `orders` | Order creation snapshots, Customer reads, Merchant accept/reject/prepare/ready |
| `delivery` | Delivery aggregate at Driver Matching start; Customer/Merchant reads; assigned-Driver logistics actions |
| `matching` | Driver candidate matching, assignment offers, accept/reject/timeout |
| `tracking` | Authenticated live location, actor-scoped Delivery rooms, HTTP+socket bootstrap |
| `zones` | Service zones |
| `pricing` | Delivery pricing versions |
| `merchant-commissions` | Merchant Commission Foundation v1.0: GLOBAL_DEFAULT / MERCHANT_OVERRIDE, integer-floor snapshot at Order creation, internal rule management |
| `driver-remuneration` | Driver pay (not COD cash) |
| `payments` | ELECTRONIC Payment initiation, Chargily Pay V2 adapter, verified webhooks, PaymentTransaction history |
| `cod` | COD Foundation v1.0: exact cash collection, Payment SUCCEEDED, Driver custody, DECLARED remittance, internal CONFIRMED FIFO allocation |
| `refunds` | Refund lifecycle (not cancellation) |
| `promotions` | Promotions and discounts |
| `notifications` | Push / in-app / email / SMS dispatch |
| `support` | Support tickets |
| `reports` | Reporting read models |
| `admin` | Admin operations |
| `audit` | Audit log |
| `settings` | System settings |
