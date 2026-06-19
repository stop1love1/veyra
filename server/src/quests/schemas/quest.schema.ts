import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
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

  @Prop({ type: Types.ObjectId, ref: 'Voucher', required: false })
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

  @Prop({ type: Boolean, default: true })
  active: boolean;
}

export const QuestSchema = SchemaFactory.createForClass(Quest);
