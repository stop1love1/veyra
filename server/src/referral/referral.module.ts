import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { ReferralController } from './referral.controller';
import { ReferralService } from './referral.service';

@Module({
  // UsersModule re-exports the User model. ReferralService depends ONLY on it
  // (no Quest/Progression dep) so other modules can import this without a cycle.
  imports: [UsersModule],
  controllers: [ReferralController],
  providers: [ReferralService],
  exports: [ReferralService],
})
export class ReferralModule {}
