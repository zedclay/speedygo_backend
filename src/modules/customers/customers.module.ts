import { Module } from '@nestjs/common';
import { CustomerAddressService } from './application/customer-address.service';
import { CustomerProfileService } from './application/customer-profile.service';
import { CustomerRepository } from './infrastructure/customer.repository';
import { CustomerController } from './presentation/http/customer.controller';

@Module({
  controllers: [CustomerController],
  providers: [
    CustomerRepository,
    CustomerProfileService,
    CustomerAddressService,
  ],
})
export class CustomersModule {}
