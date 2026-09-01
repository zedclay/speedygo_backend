import { Module } from '@nestjs/common';
import { AccountRepository } from './account.repository';

@Module({
  providers: [AccountRepository],
  exports: [AccountRepository],
})
export class IdentityModule {}
