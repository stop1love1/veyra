import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { QuestsModule } from '../quests/quests.module';
import { VouchersModule } from '../vouchers/vouchers.module';
import { ProgressionController } from './progression.controller';
import { ProgressionService } from './progression.service';

@Module({
  imports: [
    // UsersModule re-exports the User model; QuestsModule re-exports Quest +
    // UserQuest; VouchersModule re-exports Voucher + UserVoucher (for the
    // streak milestone voucher) — inject all without re-registering schemas.
    UsersModule,
    QuestsModule,
    VouchersModule,
  ],
  controllers: [ProgressionController],
  providers: [ProgressionService],
  exports: [ProgressionService],
})
export class ProgressionModule {}
