import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserVoucherDocument = HydratedDocument<UserVoucher>;

/**
 * Join record: a user has redeemed a voucher. `usedAt` is stamped at redeem time.
 */
@Schema({ timestamps: true })
export class UserVoucher {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Voucher', required: true, index: true })
  voucherId: Types.ObjectId;

  @Prop({ type: Date, required: false })
  usedAt?: Date;
}

export const UserVoucherSchema = SchemaFactory.createForClass(UserVoucher);

// A user may redeem a given voucher at most once. This unique compound index is
// the atomic gate that closes the check-then-insert double-redeem race.
UserVoucherSchema.index({ userId: 1, voucherId: 1 }, { unique: true });
