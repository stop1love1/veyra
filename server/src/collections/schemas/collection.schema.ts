import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { I18n, I18nSchema } from '../../common/i18n';

@Schema({ _id: false })
export class CollectionReward {
  @Prop({ type: Number, default: 0 })
  coins: number;

  @Prop({ type: Number, default: 0 })
  renown: number;

  // Voucher code granted on claim (owned tier). Resolved to a Voucher at claim.
  @Prop({ type: String, required: false })
  voucherCode?: string;
}
export const CollectionRewardSchema = SchemaFactory.createForClass(CollectionReward);

export type CollectionDocument = HydratedDocument<Collection>;

@Schema({ timestamps: true })
export class Collection {
  @Prop({ type: String, required: true, unique: true, index: true })
  key: string;

  @Prop({ type: I18nSchema, required: true })
  title: I18n;

  // Catalog product ids that make up the look (matches the client catalog ids).
  @Prop({ type: [String], default: [] })
  productIds: string[];

  @Prop({ type: CollectionRewardSchema, default: () => ({}) })
  styledReward: CollectionReward;

  @Prop({ type: CollectionRewardSchema, default: () => ({}) })
  ownedReward: CollectionReward;

  @Prop({ type: Boolean, default: true })
  active: boolean;
}

export const CollectionSchema = SchemaFactory.createForClass(Collection);
