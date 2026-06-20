import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { QuestsModule } from '../quests/quests.module';
import { VouchersModule } from '../vouchers/vouchers.module';
import { ReferralModule } from '../referral/referral.module';
import { ProgressionController } from './progression.controller';
import { ProgressionService } from './progression.service';

@Module({
  imports: [
    // UsersModule re-exports the User model; QuestsModule re-exports Quest +
    // UserQuest; VouchersModule re-exports Voucher + UserVoucher (for the
    // streak milestone voucher); ReferralModule provides referral payouts.
    UsersModule,
    QuestsModule,
    VouchersModule,
    ReferralModule,
  ],
  controllers: [ProgressionController],
  providers: [ProgressionService],
  exports: [ProgressionService],
})
export class ProgressionModule {}
