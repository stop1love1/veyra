import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { Role } from '../../common/roles.enum';

/**
 * Embedded avatar customization (matches the client's character builder).
 */
@Schema({ _id: false })
export class Avatar {
  @Prop({ type: String, default: '' })
  name: string;

  @Prop({ type: Number, default: 0 })
  hue: number;

  @Prop({ type: Number, default: 0 })
  skin: number;

  @Prop({ type: String, default: '' })
  style: string;
}

export const AvatarSchema = SchemaFactory.createForClass(Avatar);

/**
 * Embedded seller profile — present when role === 'seller'.
 */
@Schema({ _id: false })
export class SellerProfile {
  @Prop({ type: String, default: '' })
  displayName: string;

  @Prop({ type: String, default: '' })
  bio: string;

  @Prop({ type: Boolean, default: false })
  approved: boolean;
}

export const SellerProfileSchema = SchemaFactory.createForClass(SellerProfile);

export type UserDocument = HydratedDocument<User>;

@Schema({
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, unknown>) => {
      // Never serialize the bcrypt hash (or the mongoose version key).
      delete ret.passwordHash;
      delete ret.__v;
      return ret;
    },
  },
})
export class User {
  @Prop({ type: String, required: true, unique: true, index: true })
  email: string;

  @Prop({ type: String })
  passwordHash?: string;

  @Prop({ type: String, default: '' })
  name: string;

  @Prop({
    type: String,
    enum: Object.values(Role),
    default: Role.User,
    index: true,
  })
  role: Role;

  @Prop({ type: String, default: 'active' })
  status: string;

  @Prop({ type: AvatarSchema, default: () => ({}) })
  avatar: Avatar;

  @Prop({ type: Number, default: 1280 })
  coins: number;

  // Permanent reputation that drives the rank ladder (see progression module).
  // Never decreases; spending coins never affects it.
  @Prop({ type: Number, default: 0, index: true })
  renown: number;

  // Daily Renown-cap bookkeeping: `renownDay` is the local YYYY-MM-DD the
  // counters apply to; `renownToday` maps source → events counted that day.
  @Prop({ type: String, default: '' })
  renownDay: string;

  @Prop({ type: Object, default: {} })
  renownToday: Record<string, number>;

  // Daily check-in streak: current consecutive days, the last check-in day
  // (YYYY-MM-DD, server local), and the best streak ever reached.
  @Prop({ type: Number, default: 0 })
  streakCount: number;

  @Prop({ type: String, default: '' })
  streakLastDay: string;

  @Prop({ type: Number, default: 0 })
  streakBest: number;

  // Referral: each user's own share code, who referred them, whether that
  // referral has paid out (one-time), and how many friends they've converted.
  // No default: absent until assigned at registration, so the unique+sparse
  // index never trips on multiple "empty" users (sparse skips missing values,
  // but would still collide on repeated '').
  @Prop({ type: String, required: false, unique: true, sparse: true, index: true })
  referralCode?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  referredBy: Types.ObjectId | null;

  @Prop({ type: Boolean, default: false })
  referralRewarded: boolean;

  @Prop({ type: Number, default: 0 })
  referralCount: number;

  @Prop({ type: SellerProfileSchema, required: false })
  sellerProfile?: SellerProfile;

  @Prop({ type: Date, required: false })
  lastLoginAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
