import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsMongoId,
  IsNumber,
  IsObject,
  IsOptional,
  ValidateNested,
} from 'class-validator';

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

export class TransformDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => Vec3Dto)
  pos?: Vec3Dto;

  @IsOptional()
  @ValidateNested()
  @Type(() => Vec3Dto)
  rot?: Vec3Dto;

  @IsOptional()
  @IsNumber()
  scale?: number;
}

export class CreateMapInstanceDto {
  @IsMongoId()
  itemId: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => TransformDto)
  transform?: TransformDto;

  @IsOptional()
  @IsEnum(['ground', 'roads', 'buildings', 'props', 'skyline'])
  layer?: string;

  @IsOptional()
  @IsBoolean()
  shadow?: boolean;

  @IsOptional()
  @IsObject()
  props?: Record<string, unknown>;
}
