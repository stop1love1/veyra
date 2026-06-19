import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, HydratedDocument, Types } from 'mongoose';
import { I18n, I18nSchema } from '../../common/i18n';

/**
 * Item categories — the kinds of building blocks the admin imports into the
 * asset library (design doc §4.4).
 */
export const ITEM_CATEGORIES = [
  'building',
  'road',
  'prop',
  'nature',
  'fixture',
  'npc',
  'sign',
  'light',
  'ground',
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const ITEM_SOURCES = ['kenney', 'upload', 'builtin'] as const;
export type ItemSource = (typeof ITEM_SOURCES)[number];

export const ITEM_STATUSES = ['active', 'archived'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const COLLISION_TYPES = ['none', 'circle', 'box'] as const;
export type CollisionType = (typeof COLLISION_TYPES)[number];

/**
 * The GLB binary descriptor (metadata only; binary lives in object storage).
 */
@Schema({ _id: false })
export class GlbAsset {
  @Prop({ type: String, required: true })
  url: string;

  @Prop({ type: String, required: false })
  key?: string;

  @Prop({ type: Number, required: false })
  sizeBytes?: number;

  @Prop({ type: String, required: false })
  sha256?: string;
}
export const GlbAssetSchema = SchemaFactory.createForClass(GlbAsset);

/**
 * An optional texture binary descriptor.
 */
@Schema({ _id: false })
export class TextureAsset {
  @Prop({ type: String, required: true })
  url: string;

  @Prop({ type: String, required: false })
  key?: string;
}
export const TextureAssetSchema = SchemaFactory.createForClass(TextureAsset);

/**
 * Thumbnail image descriptor.
 */
@Schema({ _id: false })
export class ThumbnailAsset {
  @Prop({ type: String, required: false })
  url?: string;
}
export const ThumbnailAssetSchema =
  SchemaFactory.createForClass(ThumbnailAsset);

/**
 * The full asset bundle for an item.
 */
@Schema({ _id: false })
export class ItemAsset {
  @Prop({ type: GlbAssetSchema, required: true })
  glb: GlbAsset;

  @Prop({ type: [TextureAssetSchema], default: undefined })
  textures?: TextureAsset[];

  @Prop({ type: ThumbnailAssetSchema, required: false })
  thumbnail?: ThumbnailAsset;
}
export const ItemAssetSchema = SchemaFactory.createForClass(ItemAsset);

/**
 * Default transform applied when an item is placed into a map.
 */
@Schema({ _id: false })
export class TransformDefaults {
  @Prop({ type: Number, default: 7 })
  scale: number;

  @Prop({ type: Number, default: 0 })
  yOffset: number;

  @Prop({ type: String, default: '+z' })
  faceAxis: string;
}
export const TransformDefaultsSchema =
  SchemaFactory.createForClass(TransformDefaults);

/**
 * A 3D vector (x, y, z).
 */
@Schema({ _id: false })
export class Vec3 {
  @Prop({ type: Number, default: 0 })
  x: number;

  @Prop({ type: Number, default: 0 })
  y: number;

  @Prop({ type: Number, default: 0 })
  z: number;
}
export const Vec3Schema = SchemaFactory.createForClass(Vec3);

/**
 * Axis-aligned bounding box measured on import.
 */
@Schema({ _id: false })
export class Bbox {
  @Prop({ type: Vec3Schema, required: false })
  size?: Vec3;

  @Prop({ type: Vec3Schema, required: false })
  center?: Vec3;
}
export const BboxSchema = SchemaFactory.createForClass(Bbox);

/**
 * Half-extents on the ground plane (for box collision).
 */
@Schema({ _id: false })
export class CollisionHalf {
  @Prop({ type: Number, default: 0 })
  x: number;

  @Prop({ type: Number, default: 0 })
  z: number;
}
export const CollisionHalfSchema =
  SchemaFactory.createForClass(CollisionHalf);

/**
 * Collision shape for the item.
 */
@Schema({ _id: false })
export class Collision {
  @Prop({ type: String, enum: COLLISION_TYPES, default: 'none' })
  type: CollisionType;

  @Prop({ type: Number, required: false })
  radius?: number;

  @Prop({ type: CollisionHalfSchema, required: false })
  half?: CollisionHalf;
}
export const CollisionSchema = SchemaFactory.createForClass(Collision);

/**
 * Grid-snap behaviour for the map editor.
 */
@Schema({ _id: false })
export class Snap {
  @Prop({ type: Number, default: 1 })
  gridTiles: number;

  @Prop({ type: Boolean, default: true })
  walkable: boolean;
}
export const SnapSchema = SchemaFactory.createForClass(Snap);

export type ItemDocument = HydratedDocument<Item>;

/**
 * `items` — the asset library (design doc §4.4). The building blocks the admin
 * imports (GLB model + metadata) and later places into maps.
 */
@Schema({ timestamps: true })
export class Item {
  @Prop({ type: String, required: true, unique: true, index: true })
  key: string;

  @Prop({ type: I18nSchema, required: true })
  name: I18n;

  @Prop({
    type: String,
    enum: ITEM_CATEGORIES,
    required: true,
    index: true,
  })
  category: ItemCategory;

  @Prop({ type: String, enum: ITEM_SOURCES, default: 'upload' })
  source: ItemSource;

  @Prop({ type: String, default: '' })
  license: string;

  @Prop({ type: ItemAssetSchema, required: true })
  asset: ItemAsset;

  @Prop({ type: TransformDefaultsSchema, default: () => ({}) })
  transformDefaults: TransformDefaults;

  @Prop({ type: BboxSchema, required: false })
  bbox?: Bbox;

  @Prop({ type: CollisionSchema, default: () => ({}) })
  collision: Collision;

  @Prop({ type: SnapSchema, default: () => ({}) })
  snap: Snap;

  @Prop({ type: [String], default: [], index: true })
  tags: string[];

  @Prop({ type: Number, default: 1 })
  version: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy: Types.ObjectId;

  @Prop({ type: String, enum: ITEM_STATUSES, default: 'active', index: true })
  status: ItemStatus;
}

export const ItemSchema = SchemaFactory.createForClass(Item);
