import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, HydratedDocument, Types } from 'mongoose';
import { I18n, I18nSchema } from '../../common/i18n';

/**
 * Embedded aggregate stats for a shop (no own _id).
 */
@Schema({ _id: false })
export class ShopStats {
  @Prop({ type: Number, default: 0 })
  rating: number;

  @Prop({ type: Number, default: 0 })
  sold: number;
}

export const ShopStatsSchema = SchemaFactory.createForClass(ShopStats);

export type ShopDocument = HydratedDocument<Shop>;

/**
 * A seller's storefront (design doc §4.2). Also a map placement target.
 */
@Schema({ timestamps: true })
export class Shop {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  sellerId: Types.ObjectId;

  @Prop({ type: I18nSchema, required: true })
  name: I18n;

  @Prop({ type: String, required: true, unique: true, index: true })
  slug: string;

  @Prop({ type: I18nSchema, default: () => ({}) })
  category: I18n;

  @Prop({ type: I18nSchema, default: () => ({}) })
  blurb: I18n;

  @Prop({ type: Number, default: 0 })
  hue: number;

  @Prop({ type: Boolean, default: false })
  featured: boolean;

  @Prop({
    type: String,
    enum: ['draft', 'published', 'suspended'],
    default: 'draft',
    index: true,
  })
  status: string;

  // The in-store NPC advisor (optional).
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Npc', required: false })
  advisorNpcId?: Types.ObjectId;

  // Optional custom shop interior map.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Map', required: false })
  interiorMapId?: Types.ObjectId;

  @Prop({ type: ShopStatsSchema, default: () => ({}) })
  stats: ShopStats;
}

export const ShopSchema = SchemaFactory.createForClass(Shop);
