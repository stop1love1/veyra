import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { VouchersModule } from '../vouchers/vouchers.module';
import { ReferralModule } from '../referral/referral.module';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';
import { Collection, CollectionSchema } from './schemas/collection.schema';
import {
  UserCollection,
  UserCollectionSchema,
} from './schemas/user-collection.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Collection.name, schema: CollectionSchema },
      { name: UserCollection.name, schema: UserCollectionSchema },
    ]),
    // UsersModule (User), VouchersModule (Voucher/UserVoucher), ReferralModule
    // (milestone payout) — injected without re-registering their schemas.
    UsersModule,
    VouchersModule,
    ReferralModule,
  ],
  controllers: [CollectionsController],
  providers: [CollectionsService],
  exports: [CollectionsService],
})
export class CollectionsModule {}
