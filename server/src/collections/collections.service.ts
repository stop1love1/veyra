import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Voucher, VoucherDocument } from '../vouchers/schemas/voucher.schema';
import {
  UserVoucher,
  UserVoucherDocument,
} from '../vouchers/schemas/user-voucher.schema';
import { ReferralService } from '../referral/referral.service';
import { Collection, CollectionDocument } from './schemas/collection.schema';
import {
  UserCollection,
  UserCollectionDocument,
} from './schemas/user-collection.schema';

@Injectable()
export class CollectionsService {
  constructor(
    @InjectModel(Collection.name)
    private readonly collectionModel: Model<CollectionDocument>,
    @InjectModel(UserCollection.name)
    private readonly userCollectionModel: Model<UserCollectionDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Voucher.name)
    private readonly voucherModel: Model<VoucherDocument>,
    @InjectModel(UserVoucher.name)
    private readonly userVoucherModel: Model<UserVoucherDocument>,
    private readonly referral: ReferralService,
  ) {}

  listActive(): Promise<CollectionDocument[]> {
    return this.collectionModel.find({ active: true }).sort({ createdAt: 1 }).exec();
  }

  async listForUser(userId: string): Promise<
    Array<{ collection: CollectionDocument; userCollection: UserCollectionDocument | null }>
  > {
    const uid = new Types.ObjectId(userId);
    const [cols, ucs] = await Promise.all([
      this.collectionModel.find({ active: true }).sort({ createdAt: 1 }).exec(),
      this.userCollectionModel.find({ userId: uid }).exec(),
    ]);
    const byKey = new Map<string, UserCollectionDocument>();
    for (const uc of ucs) byKey.set(uc.collectionKey, uc);
    return cols.map((collection) => ({
      collection,
      userCollection: byKey.get(collection.key) ?? null,
    }));
  }

  /**
   * Claim a collection tier's reward once. Completion is client-reported (the
   * client only enables the action when favorites/purchases satisfy the tier);
   * the server owns the reward + the one-time claim flag.
   */
  async claim(
    userId: string,
    key: string,
    tier: 'styled' | 'owned',
  ): Promise<UserCollectionDocument> {
    const uid = new Types.ObjectId(userId);
    const collection = await this.collectionModel.findOne({ key }).exec();
    if (!collection) throw new NotFoundException('Collection not found');

    const field = tier === 'styled' ? 'styledClaimed' : 'ownedClaimed';
    const reward = tier === 'styled' ? collection.styledReward : collection.ownedReward;

    // Ensure a progress doc exists, then atomically flip the tier's flag.
    await this.userCollectionModel
      .updateOne(
        { userId: uid, collectionKey: key },
        { $setOnInsert: { styledClaimed: false, ownedClaimed: false } },
        { upsert: true },
      )
      .exec();

    const claimed = await this.userCollectionModel
      .findOneAndUpdate(
        { userId: uid, collectionKey: key, [field]: false },
        { $set: { [field]: true } },
        { new: true },
      )
      .exec();
    if (!claimed) throw new ConflictException('Collection tier already claimed');

    const inc: Record<string, number> = {};
    if (reward?.coins) inc.coins = reward.coins;
    if (reward?.renown) inc.renown = reward.renown;
    if (Object.keys(inc).length > 0) {
      await this.userModel.updateOne({ _id: uid }, { $inc: inc }).exec();
    }

    if (reward?.voucherCode) {
      const voucher = await this.voucherModel.findOne({ code: reward.voucherCode }).exec();
      if (voucher) {
        try {
          await this.userVoucherModel.create({
            userId: uid,
            voucherId: voucher._id,
            usedAt: new Date(),
          } as Partial<UserVoucher>);
        } catch (err: unknown) {
          if (!(err && typeof err === 'object' && (err as { code?: number }).code === 11000)) {
            throw err;
          }
        }
      }
    }

    if (inc.renown) await this.referral.maybeAwardReferral(userId);
    return claimed;
  }
}
