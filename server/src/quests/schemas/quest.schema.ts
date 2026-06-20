import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, HydratedDocument, Types } from 'mongoose';
import { I18n, I18nSchema } from '../../common/i18n';

/**
 * Quest goal — what the user must accomplish (e.g. type='order', count=3).
 */
@Schema({ _id: false })
export class QuestGoal {
  @Prop({ type: String, required: true })
  type: string;

  @Prop({ type: Number, required: true, default: 1 })
  count: number;
}

export const QuestGoalSchema = SchemaFactory.createForClass(QuestGoal);

/**
 * Quest reward — coins and/or a voucher granted on claim.
 */
@Schema({ _id: false })
export class QuestReward {
  @Prop({ type: Number, required: false })
  coins?: number;

  // Renown granted on claim. Story rewards are not daily-capped.
  @Prop({ type: Number, required: false })
  renown?: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Voucher', required: false })
  voucherId?: Types.ObjectId;
}

export const QuestRewardSchema = SchemaFactory.createForClass(QuestReward);

export type QuestDocument = HydratedDocument<Quest>;

@Schema({ timestamps: true })
export class Quest {
  @Prop({ type: String, required: true, unique: true, index: true })
  key: string;

  @Prop({ type: I18nSchema, required: true })
  title: I18n;

  @Prop({ type: QuestGoalSchema, required: true })
  goal: QuestGoal;

  @Prop({ type: QuestRewardSchema, default: () => ({}) })
  reward: QuestReward;

  // Which Renown source advances this quest (e.g. 'explore', 'purchase').
  // A POST /me/progress event bumps every active quest sharing its source.
  @Prop({ type: String, default: '', index: true })
  source: string;

  // Story chapter: 0 = daily/repeatable, 1..4 = the four district chapters.
  @Prop({ type: Number, default: 0 })
  chapter: number;

  // Daily/repeatable flag (UI grouping; claim semantics unchanged).
  @Prop({ type: Boolean, default: false })
  daily: boolean;

  // Coming-soon placeholder (e.g. real-world QR) — visible but not claimable.
  @Prop({ type: Boolean, default: false })
  locked: boolean;

  @Prop({ type: Boolean, default: true })
  active: boolean;
}

export const QuestSchema = SchemaFactory.createForClass(Quest);
