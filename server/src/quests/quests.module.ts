import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { VouchersModule } from '../vouchers/vouchers.module';
import { ReferralModule } from '../referral/referral.module';
import { QuestsController } from './quests.controller';
import { QuestsService } from './quests.service';
import { Quest, QuestSchema } from './schemas/quest.schema';
import { UserQuest, UserQuestSchema } from './schemas/user-quest.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Quest.name, schema: QuestSchema },
      { name: UserQuest.name, schema: UserQuestSchema },
    ]),
    // UsersModule re-exports MongooseModule (User model) — inject it to award
    // reward coins on claim without re-registering the User schema we don't own.
    UsersModule,
    // VouchersModule re-exports MongooseModule (UserVoucher model) so we can
    // grant a voucher reward on claim.
    VouchersModule,
    // ReferralModule pays out a referral when a claim crosses the milestone.
    ReferralModule,
  ],
  controllers: [QuestsController],
  providers: [QuestsService],
  // Re-export so a later integration step / other modules can inject the service.
  exports: [QuestsService, MongooseModule],
})
export class QuestsModule {}
