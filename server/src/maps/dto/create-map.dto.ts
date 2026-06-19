import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class SunDto {
  @IsOptional()
  @IsNumber()
  intensity?: number;

  @IsOptional()
  @IsNumber()
  azimuth?: number;

  @IsOptional()
  @IsNumber()
  elevation?: number;

  @IsOptional()
  @IsString()
  color?: string;
}

export class FogDto {
  @IsOptional()
  @IsNumber()
  near?: number;

  @IsOptional()
  @IsNumber()
  far?: number;

  @IsOptional()
  @IsString()
  color?: string;
}

export class EnvironmentDto {
  @IsOptional()
  @IsString()
  skyColor?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SunDto)
  sun?: SunDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => FogDto)
  fog?: FogDto;

  @IsOptional()
  @IsEnum(['room', 'none'])
  ibl?: string;
}

export class BoundsDto {
  @IsOptional()
  @IsNumber()
  outerRadius?: number;
}

export class Point2DDto {
  @IsNumber()
  x: number;

  @IsNumber()
  z: number;
}

export class SpawnPointDto {
  @IsString()
  id: string;

  @ValidateNested()
  @Type(() => Point2DDto)
  pos: Point2DDto;

  @IsOptional()
  @IsNumber()
  ry?: number;
}

export class ZoneDto {
  @IsString()
  id: string;

  @IsEnum(['walkable', 'road', 'blocked'])
  kind: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Point2DDto)
  polygon: Point2DDto[];
}

export class ShopSlotDto {
  @IsString()
  id: string;

  @ValidateNested()
  @Type(() => Point2DDto)
  pos: Point2DDto;

  @IsOptional()
  @IsNumber()
  ry?: number;

  @IsOptional()
  @IsMongoId()
  shopId?: string;
}

export class NpcSlotDto {
  @IsString()
  id: string;

  @ValidateNested()
  @Type(() => Point2DDto)
  pos: Point2DDto;

  @IsOptional()
  @IsNumber()
  ry?: number;

  @IsOptional()
  @IsMongoId()
  npcId?: string;
}

export class CreateMapDto {
  @IsString()
  name: string;

  @IsString()
  slug: string;

  @IsEnum(['world', 'district', 'shop-interior', 'gate'])
  kind: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  version?: number;

  @IsOptional()
  @IsEnum(['draft', 'published', 'archived'])
  status?: string;

  @IsOptional()
  @IsNumber()
  tileSize?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => EnvironmentDto)
  environment?: EnvironmentDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BoundsDto)
  bounds?: BoundsDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SpawnPointDto)
  spawnPoints?: SpawnPointDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ZoneDto)
  zones?: ZoneDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShopSlotDto)
  shopSlots?: ShopSlotDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NpcSlotDto)
  npcSlots?: NpcSlotDto[];
}
