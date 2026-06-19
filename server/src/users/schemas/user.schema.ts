import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
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

  @Prop({ type: SellerProfileSchema, required: false })
  sellerProfile?: SellerProfile;

  @Prop({ type: Date, required: false })
  lastLoginAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
