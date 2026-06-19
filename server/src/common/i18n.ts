import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * Bilingual text block embedded in other schemas (matches the client's tx() pattern).
 * Stored as a sub-document with no own _id.
 *
 * Usage in a parent schema:
 *   @Prop({ type: I18nSchema }) name: I18n;
 *   @Prop({ type: [I18nSchema] }) tags: I18n[];
 */
@Schema({ _id: false })
export class I18n {
  @Prop({ type: String, default: '' })
  vi: string;

  @Prop({ type: String, default: '' })
  en: string;
}

export type I18nType = { vi: string; en: string };

export const I18nSchema = SchemaFactory.createForClass(I18n);
