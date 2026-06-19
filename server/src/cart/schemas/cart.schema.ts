import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, HydratedDocument, Types } from 'mongoose';

/**
 * A single line in a user's cart. A line is uniquely identified within a cart
 * by the combination of productId + size + color (same product in a different
 * size/color is a distinct line).
 */
@Schema({ _id: false })
export class CartLine {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  @Prop({ type: String, default: '' })
  size: string;

  @Prop({ type: Number, default: 0 })
  color: number;

  @Prop({ type: Number, required: true, default: 1, min: 1 })
  qty: number;
}

export const CartLineSchema = SchemaFactory.createForClass(CartLine);

export type CartDocument = HydratedDocument<Cart>;

@Schema({ timestamps: true })
export class Cart {
  // One cart per user.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: [CartLineSchema], default: [] })
  lines: CartLine[];
}

export const CartSchema = SchemaFactory.createForClass(Cart);
