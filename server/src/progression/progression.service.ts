import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Quest, QuestDocument } from '../quests/schemas/quest.schema';
import {
  UserQuest,
  UserQuestDocument,
} from '../quests/schemas/user-quest.schema';
import { Voucher, VoucherDocument } from '../vouchers/schemas/voucher.schema';
import {
  UserVoucher,
  UserVoucherDocument,
} from '../vouchers/schemas/user-voucher.schema';
import { I18nType } from '../common/i18n';
import {
  RANKS,
  SOURCES,
  deriveRank,
  isRenownSource,
  renownGain,
  type RankInfo,
} from './progression.logic';
import {
  streakReward,
  streakOutcome,
} from './streak.logic';

export interface ProgressResult {
  renown: number;
  rank: RankInfo;
  gained: number;
}

export interface CheckinResult {
  alreadyToday: boolean;
  streak: number;
  best: number;
  reward: { coins: number; renown: number; voucherCode?: string };
  renown: number;
  rank: RankInfo;
}

export interface LeaderRow {
  position: number;
  name: string;
  avatarHue: number;
  renown: number;
  rankIndex: number;
  rankName: I18nType;
}

export interface LeaderboardResult {
  top: LeaderRow[];
  me?: { position: number; renown: number; rankName: I18nType };
}

@Injectable()
export class ProgressionService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Quest.name)
    private readonly questModel: Model<QuestDocument>,
    @InjectModel(UserQuest.name)
    private readonly userQuestModel: Model<UserQuestDocument>,
    @InjectModel(Voucher.name)
    private readonly voucherModel: Model<VoucherDocument>,
    @InjectModel(UserVoucher.name)
    private readonly userVoucherModel: Model<UserVoucherDocument>,
  ) {}

  /** Static config the client mirrors so nothing (ranks/caps) is hardcoded FE. */
  getConfig() {
    return { ranks: RANKS, sources: SOURCES };
  }

  /** Server-local calendar day key (YYYY-MM-DD) for daily Renown caps. */
  private dayKey(now = new Date()): string {
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${m}-${d}`;
  }

  /**
   * Record one ambient progress event for a user: apply the per-source daily
   * cap, add the capped Renown to the account, and advance every active quest
   * that shares the event's source. Returns the new renown + derived rank.
   */
  async recordEvent(userId: string, event: string): Promise<ProgressResult> {
    if (!isRenownSource(event)) {
      throw new BadRequestException('Unknown progress event');
    }
    const uid = new Types.ObjectId(userId);
    const user = await this.userModel.findById(uid).exec();
    if (!user) throw new NotFoundException('User not found');

    const today = this.dayKey();
    const sameDay = user.renownDay === today;
    const counts: Record<string, number> = sameDay
      ? { ...(user.renownToday ?? {}) }
      : {};
    const usedToday = counts[event] ?? 0;
    const gain = renownGain(event, usedToday);

    if (gain > 0) {
      counts[event] = usedToday + 1;
      await this.userModel
        .updateOne(
          { _id: uid },
          { $inc: { renown: gain }, $set: { renownDay: today, renownToday: counts } },
        )
        .exec();

      await this.bumpQuestsForSource(uid, event);
    }

    const renown = (user.renown ?? 0) + gain;
    return { renown, rank: deriveRank(renown), gained: gain };
  }

  /**
   * Advance every active, unlocked quest driven by `source` for this user. The
   * pipeline update is upsert-safe and caps progress at the quest goal.
   */
  private async bumpQuestsForSource(uid: Types.ObjectId, source: string): Promise<void> {
    const quests = await this.questModel
      .find({ active: true, locked: { $ne: true }, source })
      .exec();
    for (const q of quests) {
      await this.userQuestModel
        .updateOne(
          { userId: uid, questId: q._id },
          [
            {
              $set: {
                progress: {
                  $min: [{ $add: [{ $ifNull: ['$progress', 0] }, 1] }, q.goal.count],
                },
                claimed: { $ifNull: ['$claimed', false] },
              },
            },
          ],
          { upsert: true },
        )
        .exec();
    }
  }

  /**
   * Daily check-in: advance (or reset) the streak, grant the escalating reward,
   * advance the daily-source quests, and grant the milestone voucher. Idempotent
   * within a day — a second call the same day returns `alreadyToday: true`.
   */
  async checkin(userId: string): Promise<CheckinResult> {
    const uid = new Types.ObjectId(userId);
    const user = await this.userModel.findById(uid).exec();
    if (!user) throw new NotFoundException('User not found');

    const today = this.dayKey();
    const yesterday = this.dayKey(new Date(Date.now() - 86400000));
    const outcome = streakOutcome(user.streakLastDay ?? '', today, yesterday);

    if (outcome === 'same-day') {
      return {
        alreadyToday: true,
        streak: user.streakCount ?? 0,
        best: user.streakBest ?? 0,
        reward: { coins: 0, renown: 0 },
        renown: user.renown ?? 0,
        rank: deriveRank(user.renown ?? 0),
      };
    }

    const newStreak = outcome === 'continued' ? (user.streakCount ?? 0) + 1 : 1;
    const reward = streakReward(newStreak);
    const best = Math.max(user.streakBest ?? 0, newStreak);

    await this.userModel
      .updateOne(
        { _id: uid },
        {
          $set: { streakCount: newStreak, streakLastDay: today, streakBest: best },
          $inc: { coins: reward.coins, renown: reward.renown },
        },
      )
      .exec();

    // The daily check-in also advances the 'daily'-source quest(s).
    await this.bumpQuestsForSource(uid, 'daily');

    // Grant the milestone voucher (idempotent against the unique user+voucher index).
    if (reward.voucherCode) {
      const voucher = await this.voucherModel
        .findOne({ code: reward.voucherCode })
        .exec();
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

    const renown = (user.renown ?? 0) + reward.renown;
    return {
      alreadyToday: false,
      streak: newStreak,
      best,
      reward,
      renown,
      rank: deriveRank(renown),
    };
  }

  /**
   * Public Tastemaker leaderboard: top players by renown (renown > 0). When a
   * viewer is known, also returns their own global position.
   */
  async leaderboard(limit: number, viewerId?: string): Promise<LeaderboardResult> {
    const safe = Math.min(100, Math.max(1, limit || 20));
    const rows = await this.userModel
      .find({ renown: { $gt: 0 } })
      .sort({ renown: -1 })
      .limit(safe)
      .select('name avatar renown')
      .exec();

    const top: LeaderRow[] = rows.map((u, i) => {
      const r = deriveRank(u.renown ?? 0);
      return {
        position: i + 1,
        name: u.name || 'Lữ khách',
        avatarHue: u.avatar?.hue ?? 0,
        renown: u.renown ?? 0,
        rankIndex: r.index,
        rankName: r.name,
      };
    });

    const result: LeaderboardResult = { top };
    if (viewerId) {
      const me = await this.userModel.findById(new Types.ObjectId(viewerId)).select('renown').exec();
      if (me) {
        const myRenown = me.renown ?? 0;
        const ahead = await this.userModel.countDocuments({ renown: { $gt: myRenown } }).exec();
        result.me = { position: ahead + 1, renown: myRenown, rankName: deriveRank(myRenown).name };
      }
    }
    return result;
  }
}
