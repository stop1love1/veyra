import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, HydratedDocument, Types } from 'mongoose';
import { I18n, I18nSchema } from '../../common/i18n';

/**
 * A single ordered line. Product name/price are SNAPSHOTTED at checkout so the
 * order is immutable even if the product changes or is removed later.
 */
@Schema({ _id: false })
export class OrderLine {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Shop', required: true, index: true })
  shopId: Types.ObjectId;

  // Snapshot of the bilingual product name at purchase time.
  @Prop({ type: I18nSchema, required: true })
  name: I18n;

  // Snapshot of the unit price at purchase time.
  @Prop({ type: Number, required: true })
  price: number;

  @Prop({ type: Number, required: true, default: 1 })
  qty: number;

  @Prop({ type: String, required: false })
  size?: string;

  @Prop({ type: Number, required: false })
  color?: number;
}

export const OrderLineSchema = SchemaFactory.createForClass(OrderLine);

/**
 * Payment details. Defaults to cash-on-delivery (the stub gateway).
 */
@Schema({ _id: false })
export class OrderPayment {
  @Prop({ type: String, default: 'cod' })
  method: string;
}

export const OrderPaymentSchema = SchemaFactory.createForClass(OrderPayment);

/**
 * Shipping details — free-form address block for the stub flow.
 */
@Schema({ _id: false })
export class OrderShipping {
  @Prop({ type: String, required: false })
  name?: string;

  @Prop({ type: String, required: false })
  phone?: string;

  @Prop({ type: String, required: false })
  address?: string;

  @Prop({ type: String, required: false })
  note?: string;
}

export const OrderShippingSchema = SchemaFactory.createForClass(OrderShipping);

export type OrderDocument = HydratedDocument<Order>;

/**
 * A placed order. Lines snapshot product name/price; `total` is computed at
 * checkout. Status walks pending → paid → shipped → done (or cancelled).
 */
@Schema({ timestamps: true })
export class Order {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: [OrderLineSchema], default: [] })
  lines: OrderLine[];

  @Prop({ type: Number, required: true, default: 0 })
  total: number;

  @Prop({
    type: String,
    enum: ['pending', 'paid', 'shipped', 'done', 'cancelled'],
    default: 'pending',
    index: true,
  })
  status: string;

  @Prop({ type: OrderPaymentSchema, default: () => ({ method: 'cod' }) })
  payment: OrderPayment;

  @Prop({ type: OrderShippingSchema, default: () => ({}) })
  shipping: OrderShipping;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Voucher', required: false })
  voucherId?: Types.ObjectId;
}

export const OrderSchema = SchemaFactory.createForClass(Order);
