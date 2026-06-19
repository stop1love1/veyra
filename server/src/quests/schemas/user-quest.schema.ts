import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, HydratedDocument, Types } from 'mongoose';

export type UserQuestDocument = HydratedDocument<UserQuest>;

/**
 * Per-user progress on a quest. Unique on (userId, questId).
 */
@Schema({ timestamps: true })
export class UserQuest {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Quest', required: true, index: true })
  questId: Types.ObjectId;

  @Prop({ type: Number, default: 0 })
  progress: number;

  @Prop({ type: Boolean, default: false })
  claimed: boolean;
}

export const UserQuestSchema = SchemaFactory.createForClass(UserQuest);

// One progress doc per (user, quest).
UserQuestSchema.index({ userId: 1, questId: 1 }, { unique: true });
