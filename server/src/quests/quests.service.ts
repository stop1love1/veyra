import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  UserVoucher,
  UserVoucherDocument,
} from '../vouchers/schemas/user-voucher.schema';
import { CreateQuestDto } from './dto/create-quest.dto';
import { UpdateQuestDto } from './dto/update-quest.dto';
import { Quest, QuestDocument } from './schemas/quest.schema';
import {
  UserQuest,
  UserQuestDocument,
} from './schemas/user-quest.schema';

@Injectable()
export class QuestsService {
  constructor(
    @InjectModel(Quest.name)
    private readonly questModel: Model<QuestDocument>,
    @InjectModel(UserQuest.name)
    private readonly userQuestModel: Model<UserQuestDocument>,
    // User model is available because QuestsModule imports UsersModule
    // (which re-exports MongooseModule for the User schema).
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    // UserVoucher model is available because QuestsModule imports VouchersModule.
    @InjectModel(UserVoucher.name)
    private readonly userVoucherModel: Model<UserVoucherDocument>,
  ) {}

  // ---- Public: list quests --------------------------------------------------

  listActive(): Promise<QuestDocument[]> {
    return this.questModel.find({ active: true }).sort({ createdAt: -1 }).exec();
  }

  // ---- Admin: create / update ----------------------------------------------

  async create(dto: CreateQuestDto): Promise<QuestDocument> {
    const existing = await this.questModel
      .findOne({ key: dto.key })
      .exec();
    if (existing) {
      throw new ConflictException('Quest key already exists');
    }
    // DTO nested/optional fields are looser than the persisted schema classes;
    // class-validator has already validated them — cast at the Mongoose boundary.
    return this.questModel.create(dto as unknown as Partial<Quest>);
  }

  async update(id: string, dto: UpdateQuestDto): Promise<QuestDocument> {
    const quest = await this.questModel
      .findByIdAndUpdate(id, dto as unknown as Partial<Quest>, { new: true })
      .exec();
    if (!quest) {
      throw new NotFoundException('Quest not found');
    }
    return quest;
  }

  // ---- User: own progress ---------------------------------------------------

  /**
   * The user's quest progress joined with the quest definition.
   * Returns every active quest with the user's progress doc (or null when
   * the user has not started it yet).
   */
  async listForUser(userId: string): Promise<
    Array<{ quest: QuestDocument; userQuest: UserQuestDocument | null }>
  > {
    const uid = new Types.ObjectId(userId);
    const [quests, userQuests] = await Promise.all([
      this.questModel.find({ active: true }).sort({ createdAt: -1 }).exec(),
      this.userQuestModel.find({ userId: uid }).exec(),
    ]);

    const byQuestId = new Map<string, UserQuestDocument>();
    for (const uq of userQuests) {
      byQuestId.set(uq.questId.toString(), uq);
    }

    return quests.map((quest) => ({
      quest,
      userQuest: byQuestId.get(quest._id.toString()) ?? null,
    }));
  }

  /**
   * Claim a quest's reward once. Requires an existing progress doc that has
   * met the goal and has not yet been claimed. Awards reward coins to the user
   * (atomic $inc) and flips `claimed` so the reward can never be granted twice.
   */
  async claim(
    userId: string,
    questId: string,
  ): Promise<UserQuestDocument> {
    const uid = new Types.ObjectId(userId);

    const quest = await this.questModel.findById(questId).exec();
    if (!quest) {
      throw new NotFoundException('Quest not found');
    }

    const userQuest = await this.userQuestModel
      .findOne({ userId: uid, questId: quest._id })
      .exec();
    if (!userQuest) {
      throw new NotFoundException('Quest not started');
    }
    if (userQuest.claimed) {
      throw new ConflictException('Quest reward already claimed');
    }
    if (userQuest.progress < quest.goal.count) {
      throw new ConflictException('Quest goal not yet met');
    }

    // Atomically flip claimed=false → true so the reward is granted exactly
    // once even under concurrent requests.
    const claimed = await this.userQuestModel
      .findOneAndUpdate(
        { _id: userQuest._id, claimed: false },
        { claimed: true },
        { new: true },
      )
      .exec();
    if (!claimed) {
      throw new ConflictException('Quest reward already claimed');
    }

    // Grant rewards. The atomic claimed-flip above guarantees this block runs
    // at most once per (user, quest), so neither award can be duplicated.
    const coins = quest.reward?.coins;
    if (coins && coins > 0) {
      await this.userModel
        .updateOne({ _id: uid }, { $inc: { coins } })
        .exec();
    }

    // Grant the voucher reward if the quest defines one. Idempotent against the
    // unique (userId, voucherId) index, so a retry never double-grants.
    const voucherId = quest.reward?.voucherId;
    if (voucherId) {
      try {
        await this.userVoucherModel.create({
          userId: uid,
          voucherId,
          usedAt: new Date(),
        } as Partial<UserVoucher>);
      } catch (err: unknown) {
        // Duplicate (already granted) is fine; rethrow anything else.
        if (
          !(
            err &&
            typeof err === 'object' &&
            (err as { code?: number }).code === 11000
          )
        ) {
          throw err;
        }
      }
    }

    return claimed;
  }
}
