import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { deriveRank } from '../progression/progression.logic';
import { I18nType } from '../common/i18n';
import { genCode } from './referral.codegen';

// Renown at which an invited friend "counts" (Rank 2), unlocking the reward.
const REFERRAL_MILESTONE = 100;
const REFEREE_REWARD = { coins: 50, renown: 30 };
const REFERRER_REWARD = { coins: 100, renown: 60 };

export interface PublicProfile {
  name: string;
  avatarHue: number;
  rankName: I18nType;
  rankIndex: number;
  renown: number;
  streak: number;
  referralCount: number;
}

@Injectable()
export class ReferralService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  /** A referral code not currently in use (retries on the rare collision). */
  async uniqueCode(): Promise<string> {
    for (let i = 0; i < 6; i++) {
      const code = genCode();
      const clash = await this.userModel.exists({ referralCode: code });
      if (!clash) return code;
    }
    // Extremely unlikely; fall back to a longer code to guarantee progress.
    return genCode() + genCode();
  }

  /** Resolve a referral code to its owner's id, or null. */
  async resolveReferrer(code: string): Promise<Types.ObjectId | null> {
    const owner = await this.userModel.findOne({ referralCode: code }).select('_id').exec();
    return owner ? (owner._id as Types.ObjectId) : null;
  }

  /**
   * If the user just qualified (renown >= milestone) and was referred and has
   * not paid out yet, reward BOTH sides exactly once. Safe to call after any
   * renown increase.
   */
  async maybeAwardReferral(userId: string): Promise<void> {
    const uid = new Types.ObjectId(userId);
    const user = await this.userModel
      .findById(uid)
      .select('renown referredBy referralRewarded')
      .exec();
    if (!user || !user.referredBy || user.referralRewarded) return;
    if ((user.renown ?? 0) < REFERRAL_MILESTONE) return;

    // Atomic claim of the one-time payout.
    const claimed = await this.userModel
      .findOneAndUpdate(
        { _id: uid, referralRewarded: false },
        { $set: { referralRewarded: true }, $inc: { coins: REFEREE_REWARD.coins, renown: REFEREE_REWARD.renown } },
        { new: true },
      )
      .exec();
    if (!claimed) return; // lost the race — already rewarded

    await this.userModel
      .updateOne(
        { _id: user.referredBy },
        { $inc: { coins: REFERRER_REWARD.coins, renown: REFERRER_REWARD.renown, referralCount: 1 } },
      )
      .exec();
  }

  /** The caller's own referral code + successful-invite count. */
  async myReferral(userId: string): Promise<{ code: string; count: number }> {
    const user = await this.userModel
      .findById(new Types.ObjectId(userId))
      .select('referralCode referralCount')
      .exec();
    if (!user) throw new NotFoundException('User not found');
    return { code: user.referralCode || '', count: user.referralCount ?? 0 };
  }

  /** Public share-card data for a referral code (no PII). */
  async publicProfile(code: string): Promise<PublicProfile> {
    const user = await this.userModel
      .findOne({ referralCode: code })
      .select('name avatar renown streakCount referralCount')
      .exec();
    if (!user) throw new NotFoundException('Profile not found');
    const rank = deriveRank(user.renown ?? 0);
    return {
      name: user.name || 'Lữ khách',
      avatarHue: user.avatar?.hue ?? 0,
      rankName: rank.name,
      rankIndex: rank.index,
      renown: user.renown ?? 0,
      streak: user.streakCount ?? 0,
      referralCount: user.referralCount ?? 0,
    };
  }
}
