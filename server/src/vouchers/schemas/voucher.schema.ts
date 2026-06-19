import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, HydratedDocument, Types } from 'mongoose';

export type VoucherDocument = HydratedDocument<Voucher>;

/**
 * A discount voucher. Sellers may own a voucher (sellerId); admins own the rest.
 * `uses` tracks how many times the voucher has been redeemed against `maxUses`.
 */
@Schema({ timestamps: true })
export class Voucher {
  @Prop({ type: String, required: true, unique: true, index: true })
  code: string;

  @Prop({
    type: String,
    enum: ['percent', 'amount', 'freeship'],
    required: true,
  })
  type: string;

  @Prop({ type: Number, required: true, default: 0 })
  value: number;

  // Optional owning seller. Null/undefined → platform-wide (admin) voucher.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: false, index: true })
  sellerId?: Types.ObjectId;

  @Prop({ type: Date, required: false })
  expiresAt?: Date;

  @Prop({ type: Number, required: false })
  maxUses?: number;

  @Prop({ type: Number, default: 0 })
  uses: number;
}

export const VoucherSchema = SchemaFactory.createForClass(Voucher);
