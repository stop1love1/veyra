import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * 3D position of a placed instance.
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
 * Position / rotation / uniform scale for a placed item.
 */
@Schema({ _id: false })
export class Transform {
  @Prop({ type: Vec3Schema, default: () => ({}) })
  pos: Vec3;

  @Prop({ type: Vec3Schema, default: () => ({}) })
  rot: Vec3;

  @Prop({ type: Number, default: 7 })
  scale: number;
}

export const TransformSchema = SchemaFactory.createForClass(Transform);

export type MapInstanceDocument = HydratedDocument<MapInstance>;

/**
 * One placed item in a map (the actual scene graph). A big map can hold
 * thousands of these, so they live in their own collection.
 */
@Schema({ timestamps: true })
export class MapInstance {
  @Prop({ type: Types.ObjectId, ref: 'Map', required: true, index: true })
  mapId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Item', required: true, index: true })
  itemId: Types.ObjectId;

  @Prop({ type: TransformSchema, default: () => ({}) })
  transform: Transform;

  @Prop({
    type: String,
    enum: ['ground', 'roads', 'buildings', 'props', 'skyline'],
    default: 'props',
    index: true,
  })
  layer: string;

  @Prop({ type: Boolean, default: true })
  shadow: boolean;

  @Prop({ type: Object, required: false })
  props?: Record<string, unknown>;
}

export const MapInstanceSchema = SchemaFactory.createForClass(MapInstance);
