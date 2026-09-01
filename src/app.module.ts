import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { RedisModule } from './infrastructure/cache/redis.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { RealtimeModule } from './infrastructure/realtime/realtime.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthorizationModule } from './modules/authorization/authorization.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CartModule } from './modules/cart/cart.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { CustomersModule } from './modules/customers/customers.module';
import { IdentityModule } from './modules/identity/identity.module';
import { MerchantsModule } from './modules/merchants/merchants.module';
import { OrdersModule } from './modules/orders/orders.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      load: [configuration],
    }),
    DatabaseModule,
    RedisModule,
    QueueModule,
    RealtimeModule,
    StorageModule,
    IdentityModule,
    AuthModule,
    AuthorizationModule,
    CustomersModule,
    MerchantsModule,
    CatalogModule,
    CartModule,
    CheckoutModule,
    OrdersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
