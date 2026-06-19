import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsMongoId,
  IsObject,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class I18nDto {
  @IsString()
  vi: string;

  @IsString()
  en: string;
}

export class NpcAppearanceDto {
  @IsOptional()
  @IsNumber()
  hue?: number;

  @IsOptional()
  @IsNumber()
  skin?: number;

  @IsOptional()
  @IsString()
  style?: string;
}

export class NpcDialogueActionDto {
  @IsString()
  type: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

export class NpcDialogueDto {
  @IsString()
  id: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => I18nDto)
  lines: I18nDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  picks?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => NpcDialogueActionDto)
  action?: NpcDialogueActionDto;
}

export class NpcBehaviorDto {
  @IsOptional()
  @IsIn(['idle', 'wander'])
  kind?: string;

  @IsOptional()
  @IsNumber()
  radius?: number;
}

export class CreateNpcDto {
  @IsString()
  name: string;

  @ValidateNested()
  @Type(() => I18nDto)
  persona: I18nDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => NpcAppearanceDto)
  appearance?: NpcAppearanceDto;

  @IsOptional()
  @IsMongoId()
  modelItemId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NpcDialogueDto)
  dialogue?: NpcDialogueDto[];

  @IsOptional()
  @IsMongoId()
  shopId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => NpcBehaviorDto)
  behavior?: NpcBehaviorDto;

  @IsOptional()
  @IsMongoId()
  accountUserId?: string;

  @IsOptional()
  @IsIn(['active', 'archived'])
  status?: string;
}
