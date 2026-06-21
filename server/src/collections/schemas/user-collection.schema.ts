import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, HydratedDocument, Types } from 'mongoose';

export type UserCollectionDocument = HydratedDocument<UserCollection>;

/** Per-user claim state for a collection's two tiers. Unique (userId, key). */
@Schema({ timestamps: true })
export class UserCollection {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  collectionKey: string;

  @Prop({ type: Boolean, default: false })
  styledClaimed: boolean;

  @Prop({ type: Boolean, default: false })
  ownedClaimed: boolean;
}

export const UserCollectionSchema = SchemaFactory.createForClass(UserCollection);
UserCollectionSchema.index({ userId: 1, collectionKey: 1 }, { unique: true });
