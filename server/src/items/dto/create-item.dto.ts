import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import {
  COLLISION_TYPES,
  ITEM_CATEGORIES,
  ITEM_SOURCES,
  ITEM_STATUSES,
  type CollisionType,
  type ItemCategory,
  type ItemSource,
  type ItemStatus,
} from '../schemas/item.schema';

export class I18nDto {
  @IsString()
  vi: string;

  @IsString()
  en: string;
}

export class GlbAssetDto {
  @IsString()
  url: string;

  @IsOptional()
  @IsString()
  key?: string;

  @IsOptional()
  @IsNumber()
  sizeBytes?: number;

  @IsOptional()
  @IsString()
  sha256?: string;
}

export class TextureAssetDto {
  @IsString()
  url: string;

  @IsOptional()
  @IsString()
  key?: string;
}

export class ThumbnailAssetDto {
  @IsOptional()
  @IsString()
  url?: string;
}

export class ItemAssetDto {
  @ValidateNested()
  @Type(() => GlbAssetDto)
  glb: GlbAssetDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TextureAssetDto)
  textures?: TextureAssetDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ThumbnailAssetDto)
  thumbnail?: ThumbnailAssetDto;
}

export class TransformDefaultsDto {
  @IsOptional()
  @IsNumber()
  scale?: number;

  @IsOptional()
  @IsNumber()
  yOffset?: number;

  @IsOptional()
  @IsString()
  faceAxis?: string;
}

export class Vec3Dto {
  @IsOptional()
  @IsNumber()
  x?: number;

  @IsOptional()
  @IsNumber()
  y?: number;

  @IsOptional()
  @IsNumber()
  z?: number;
}

export class BboxDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => Vec3Dto)
  size?: Vec3Dto;

  @IsOptional()
  @ValidateNested()
  @Type(() => Vec3Dto)
  center?: Vec3Dto;
}

export class CollisionHalfDto {
  @IsOptional()
  @IsNumber()
  x?: number;

  @IsOptional()
  @IsNumber()
  z?: number;
}

export class CollisionDto {
  @IsOptional()
  @IsEnum(COLLISION_TYPES)
  type?: CollisionType;

  @IsOptional()
  @IsNumber()
  radius?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => CollisionHalfDto)
  half?: CollisionHalfDto;
}

export class SnapDto {
  @IsOptional()
  @IsInt()
  gridTiles?: number;

  @IsOptional()
  @IsBoolean()
  walkable?: boolean;
}

export class CreateItemDto {
  @IsString()
  key: string;

  @ValidateNested()
  @Type(() => I18nDto)
  name: I18nDto;

  @IsEnum(ITEM_CATEGORIES)
  category: ItemCategory;

  @IsOptional()
  @IsEnum(ITEM_SOURCES)
  source?: ItemSource;

  @IsOptional()
  @IsString()
  license?: string;

  @ValidateNested()
  @Type(() => ItemAssetDto)
  asset: ItemAssetDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => TransformDefaultsDto)
  transformDefaults?: TransformDefaultsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BboxDto)
  bbox?: BboxDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CollisionDto)
  collision?: CollisionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SnapDto)
  snap?: SnapDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsInt()
  version?: number;

  @IsOptional()
  @IsEnum(ITEM_STATUSES)
  status?: ItemStatus;
}
