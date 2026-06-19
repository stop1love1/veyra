import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { I18n, I18nSchema } from '../../common/i18n';

/**
 * Embedded product image — a stored URL pointing at object storage.
 * No own _id (matches the design doc's `images:[{url}]`).
 */
@Schema({ _id: false })
export class ProductImage {
  @Prop({ type: String, required: true })
  url: string;
}

export const ProductImageSchema = SchemaFactory.createForClass(ProductImage);

export type ProductDocument = HydratedDocument<Product>;

@Schema({ timestamps: true })
export class Product {
  // Owning shop. Ownership (seller) is resolved through the shop's sellerId.
  @Prop({ type: Types.ObjectId, ref: 'Shop', required: true, index: true })
  shopId: Types.ObjectId;

  @Prop({ type: I18nSchema, required: true })
  name: I18n;

  @Prop({ type: I18nSchema, required: false })
  blurb?: I18n;

  @Prop({ type: Number, required: true })
  price: number;

  @Prop({ type: String, default: 'VND' })
  currency: string;

  @Prop({ type: [Number], default: [] })
  colors: number[];

  @Prop({ type: [String], default: [] })
  sizes: string[];

  @Prop({ type: [I18nSchema], default: [] })
  tags: I18n[];

  // Optional 3D model for the product (asset library Item).
  @Prop({ type: Types.ObjectId, ref: 'Item', required: false })
  modelItemId?: Types.ObjectId;

  @Prop({ type: [ProductImageSchema], default: [] })
  images: ProductImage[];

  @Prop({ type: Number, default: 0 })
  rating: number;

  @Prop({ type: Number, default: 0 })
  sold: number;

  @Prop({ type: Number, default: 0 })
  stock: number;

  @Prop({
    type: String,
    enum: ['active', 'hidden'],
    default: 'active',
    index: true,
  })
  status: string;
}

export const ProductSchema = SchemaFactory.createForClass(Product);

// Text index on name (per design doc §4.3 indexes).
ProductSchema.index({ 'name.vi': 'text', 'name.en': 'text' });
