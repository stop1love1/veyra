import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { I18n, I18nSchema } from '../../common/i18n';

/**
 * Embedded appearance customization for an NPC entity (no own _id).
 */
@Schema({ _id: false })
export class NpcAppearance {
  @Prop({ type: Number, default: 0 })
  hue: number;

  @Prop({ type: Number, default: 0 })
  skin: number;

  @Prop({ type: String, default: '' })
  style: string;
}

export const NpcAppearanceSchema = SchemaFactory.createForClass(NpcAppearance);

/**
 * Embedded action attached to a dialogue node (no own _id).
 * `payload` is an open object (per-action data), kept loose by design.
 */
@Schema({ _id: false })
export class NpcDialogueAction {
  @Prop({ type: String, required: true })
  type: string;

  @Prop({ type: Object, required: false })
  payload?: Record<string, unknown>;
}

export const NpcDialogueActionSchema =
  SchemaFactory.createForClass(NpcDialogueAction);

/**
 * A single dialogue node: an id, bilingual lines, optional picks (choices),
 * and an optional action triggered when reached.
 */
@Schema({ _id: false })
export class NpcDialogue {
  @Prop({ type: String, required: true })
  id: string;

  @Prop({ type: [I18nSchema], default: [] })
  lines: I18n[];

  @Prop({ type: [String], required: false })
  picks?: string[];

  @Prop({ type: NpcDialogueActionSchema, required: false })
  action?: NpcDialogueAction;
}

export const NpcDialogueSchema = SchemaFactory.createForClass(NpcDialogue);

/**
 * Embedded behavior config (no own _id).
 */
@Schema({ _id: false })
export class NpcBehavior {
  @Prop({ type: String, enum: ['idle', 'wander'], default: 'idle' })
  kind: string;

  @Prop({ type: Number, required: false })
  radius?: number;
}

export const NpcBehaviorSchema = SchemaFactory.createForClass(NpcBehavior);

export type NpcDocument = HydratedDocument<Npc>;

/**
 * NPC entity (design doc §4.7) — an in-world placeable character that can
 * optionally link to an `npc`-role account, render a 3D `Item` model, and
 * act as a shop advisor.
 */
@Schema({ timestamps: true })
export class Npc {
  @Prop({ type: String, required: true })
  name: string;

  // role/title shown in-game
  @Prop({ type: I18nSchema, required: true })
  persona: I18n;

  @Prop({ type: NpcAppearanceSchema, default: () => ({}) })
  appearance: NpcAppearance;

  // optional 3D model (else default avatar)
  @Prop({ type: Types.ObjectId, ref: 'Item', required: false, index: true })
  modelItemId?: Types.ObjectId;

  @Prop({ type: [NpcDialogueSchema], default: [] })
  dialogue: NpcDialogue[];

  // if this NPC is a shop advisor
  @Prop({ type: Types.ObjectId, ref: 'Shop', required: false, index: true })
  shopId?: Types.ObjectId;

  @Prop({ type: NpcBehaviorSchema, default: () => ({}) })
  behavior: NpcBehavior;

  // optional linked account (role=npc)
  @Prop({ type: Types.ObjectId, ref: 'User', required: false, index: true })
  accountUserId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy: Types.ObjectId;

  @Prop({
    type: String,
    enum: ['active', 'archived'],
    default: 'active',
    index: true,
  })
  status: string;
}

export const NpcSchema = SchemaFactory.createForClass(Npc);
