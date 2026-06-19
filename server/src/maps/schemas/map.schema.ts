import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * Directional sun lighting for the map environment.
 */
@Schema({ _id: false })
export class Sun {
  @Prop({ type: Number, default: 1 })
  intensity: number;

  @Prop({ type: Number, default: 0 })
  azimuth: number;

  @Prop({ type: Number, default: 0 })
  elevation: number;

  @Prop({ type: String, default: '#ffffff' })
  color: string;
}

export const SunSchema = SchemaFactory.createForClass(Sun);

/**
 * Distance fog settings.
 */
@Schema({ _id: false })
export class Fog {
  @Prop({ type: Number, default: 0 })
  near: number;

  @Prop({ type: Number, default: 0 })
  far: number;

  @Prop({ type: String, default: '#ffffff' })
  color: string;
}

export const FogSchema = SchemaFactory.createForClass(Fog);

/**
 * Scene environment (sky / sun / fog / image-based lighting).
 */
@Schema({ _id: false })
export class Environment {
  @Prop({ type: String, default: '#87ceeb' })
  skyColor: string;

  @Prop({ type: SunSchema, default: () => ({}) })
  sun: Sun;

  @Prop({ type: FogSchema, default: () => ({}) })
  fog: Fog;

  @Prop({ type: String, enum: ['room', 'none'], default: 'room' })
  ibl: string;
}

export const EnvironmentSchema = SchemaFactory.createForClass(Environment);

/**
 * Circular world bounds.
 */
@Schema({ _id: false })
export class Bounds {
  @Prop({ type: Number, default: 0 })
  outerRadius: number;
}

export const BoundsSchema = SchemaFactory.createForClass(Bounds);

/**
 * 2D point on the map plane (x/z; y derived from terrain).
 */
@Schema({ _id: false })
export class Point2D {
  @Prop({ type: Number, default: 0 })
  x: number;

  @Prop({ type: Number, default: 0 })
  z: number;
}

export const Point2DSchema = SchemaFactory.createForClass(Point2D);

/**
 * A point where the player can spawn into the map.
 */
@Schema({ _id: false })
export class SpawnPoint {
  @Prop({ type: String, required: true })
  id: string;

  @Prop({ type: Point2DSchema, required: true })
  pos: Point2D;

  @Prop({ type: Number, default: 0 })
  ry: number;
}

export const SpawnPointSchema = SchemaFactory.createForClass(SpawnPoint);

/**
 * A painted region (walkable / road / blocked) described by a polygon.
 */
@Schema({ _id: false })
export class Zone {
  @Prop({ type: String, required: true })
  id: string;

  @Prop({ type: String, enum: ['walkable', 'road', 'blocked'], required: true })
  kind: string;

  @Prop({ type: [Point2DSchema], default: [] })
  polygon: Point2D[];
}

export const ZoneSchema = SchemaFactory.createForClass(Zone);

/**
 * A slot where a shop storefront attaches to the map.
 */
@Schema({ _id: false })
export class ShopSlot {
  @Prop({ type: String, required: true })
  id: string;

  @Prop({ type: Point2DSchema, required: true })
  pos: Point2D;

  @Prop({ type: Number, default: 0 })
  ry: number;

  @Prop({ type: Types.ObjectId, ref: 'Shop', required: false })
  shopId?: Types.ObjectId;
}

export const ShopSlotSchema = SchemaFactory.createForClass(ShopSlot);

/**
 * A slot where an NPC entity attaches to the map.
 */
@Schema({ _id: false })
export class NpcSlot {
  @Prop({ type: String, required: true })
  id: string;

  @Prop({ type: Point2DSchema, required: true })
  pos: Point2D;

  @Prop({ type: Number, default: 0 })
  ry: number;

  @Prop({ type: Types.ObjectId, ref: 'Npc', required: false })
  npcId?: Types.ObjectId;
}

export const NpcSlotSchema = SchemaFactory.createForClass(NpcSlot);

export type MapDocument = HydratedDocument<Map>;

/**
 * A composition built from items (the world / a district / a shop interior / a gate).
 * Placed item instances live in the separate `mapInstances` collection.
 */
@Schema({ timestamps: true })
export class Map {
  @Prop({ type: String, required: true })
  name: string;

  @Prop({ type: String, required: true, unique: true, index: true })
  slug: string;

  @Prop({
    type: String,
    enum: ['world', 'district', 'shop-interior', 'gate'],
    required: true,
  })
  kind: string;

  @Prop({ type: String, required: false })
  description?: string;

  @Prop({ type: Number, default: 1 })
  version: number;

  @Prop({
    type: String,
    enum: ['draft', 'published', 'archived'],
    default: 'draft',
    index: true,
  })
  status: string;

  @Prop({ type: Number, default: 7 })
  tileSize: number;

  @Prop({ type: EnvironmentSchema, default: () => ({}) })
  environment: Environment;

  @Prop({ type: BoundsSchema, default: () => ({}) })
  bounds: Bounds;

  @Prop({ type: [SpawnPointSchema], default: [] })
  spawnPoints: SpawnPoint[];

  @Prop({ type: [ZoneSchema], default: [] })
  zones: Zone[];

  @Prop({ type: [ShopSlotSchema], default: [] })
  shopSlots: ShopSlot[];

  @Prop({ type: [NpcSlotSchema], default: [] })
  npcSlots: NpcSlot[];

  @Prop({ type: Date, required: false })
  publishedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', required: false, index: true })
  createdBy?: Types.ObjectId;
}

export const MapSchema = SchemaFactory.createForClass(Map);
